import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);

const SCHEMA_NAME = /^t_[0-9a-f]{16}$/;

/** First migration. Session only, so an existing template database can be baselined. */
export const SESSION_BASELINE_MIGRATION = "20261107000000_session_baseline";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const prismaCli = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");

export type TestSchema = {
  schema: string;
  url: string;
  drop: () => Promise<void>;
};

export type TestDb = TestSchema & {
  prisma: PrismaClient;
};

export type SeededShop = {
  shopId: string;
  domain: string;
};

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  return url;
}

function assertSchemaName(schema: string): void {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error("Unexpected test schema name");
  }
}

function withSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

async function execSql(url: string, sql: string): Promise<void> {
  const client = new PrismaClient({
    datasources: { db: { url } },
  });
  try {
    await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

async function runPrisma(args: string[], url: string): Promise<void> {
  try {
    await execFileAsync(process.execPath, [prismaCli, ...args], {
      cwd: repoRoot,
      timeout: 90_000,
      env: {
        ...process.env,
        DATABASE_URL: url,
        DIRECT_URL: url,
      },
    });
  } catch (error) {
    const detail =
      typeof error === "object" && error !== null
        ? [
            "stdout" in error ? String(error.stdout ?? "") : "",
            "stderr" in error ? String(error.stderr ?? "") : "",
            "message" in error ? String(error.message ?? "") : "",
          ]
            .filter((part) => part.trim().length > 0)
            .join("\n")
        : String(error);
    throw new Error(
      `prisma ${args.join(" ")} failed\n${redactConnectionStrings(detail)}`,
    );
  }
}

export async function deployMigrations(url: string): Promise<void> {
  await runPrisma(["migrate", "deploy"], url);
}

/**
 * Records a migration as applied without running its SQL.
 * Prisma creates `_prisma_migrations` itself. This is the supported baseline step.
 */
export async function markMigrationApplied(
  url: string,
  migrationName: string,
): Promise<void> {
  await runPrisma(["migrate", "resolve", "--applied", migrationName], url);
}

/** The spec 01 template database: `Session` via `db push`, and no migration history. */
export async function pushTemplateSession(url: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "lens-template-session-"));
  try {
    await writeFile(
      path.join(dir, "schema.prisma"),
      templateSessionSchema(),
      "utf8",
    );
    await runPrisma(
      [
        "db",
        "push",
        "--skip-generate",
        "--schema",
        path.join(dir, "schema.prisma"),
      ],
      url,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function templateSessionSchema(): string {
  const source = readFileSync(
    path.join(repoRoot, "prisma", "schema.prisma"),
    "utf8",
  );
  const model = source.match(/^model Session \{[\s\S]*?\n\}/m);
  if (!model) {
    throw new Error("Session model missing from prisma/schema.prisma");
  }
  return [
    "generator client {",
    '  provider = "prisma-client-js"',
    "}",
    "",
    "datasource db {",
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    "}",
    "",
    model[0],
    "",
  ].join("\n");
}

/**
 * Creates an empty Postgres schema `t_<random>` on TEST_DATABASE_URL.
 * Does not apply migrations. `drop()` removes the schema.
 */
export async function createTestSchema(): Promise<TestSchema> {
  const baseUrl = testDatabaseUrl();
  const schema = `t_${randomBytes(8).toString("hex")}`;
  assertSchemaName(schema);
  await execSql(baseUrl, `CREATE SCHEMA "${schema}"`);

  let dropped = false;
  return {
    schema,
    url: withSchema(baseUrl, schema),
    async drop() {
      if (dropped) return;
      dropped = true;
      assertSchemaName(schema);
      await execSql(baseUrl, `DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    },
  };
}

/** Applies migrations to a fresh schema and returns a client plus `drop()`. */
export async function createTestDb(): Promise<TestDb> {
  const ctx = await createTestSchema();
  try {
    await deployMigrations(ctx.url);
  } catch (error) {
    await ctx.drop();
    throw error;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: ctx.url } },
  });

  return {
    prisma,
    schema: ctx.schema,
    url: ctx.url,
    async drop() {
      await prisma.$disconnect();
      await ctx.drop();
    },
  };
}

/** One shop plus one row in every shop-owned table. Values are fixtures, not real Rx. */
export async function seedShop(
  db: PrismaClient,
  domain: string,
): Promise<SeededShop> {
  const shopId = await db.$transaction(async (tx) => {
    const shop = await tx.shop.create({
      data: {
        domain,
        installedAt: new Date("2026-01-15T00:00:00.000Z"),
      },
    });

    await tx.shopSettings.create({
      data: {
        shopId: shop.id,
        labEmails: ["lab@example.test"],
        ticketFormat: "PDF",
        storeRxInOrder: false,
        rxUploadEnabled: true,
        manualRxEnabled: true,
      },
    });

    const group = await tx.lensGroup.create({
      data: {
        shopId: shop.id,
        name: "Everyday",
        description: "Fixture group",
        position: 0,
      },
    });

    const lens = await tx.lens.create({
      data: {
        shopId: shop.id,
        groupId: group.id,
        name: "1.56",
        description: "Fixture lens",
        priceMinor: 4900,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -800,
        sphMax: 600,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "SV",
        position: 0,
      },
    });

    const optionGroup = await tx.optionGroup.create({
      data: {
        shopId: shop.id,
        kind: "MATERIAL",
        name: "Material",
        position: 0,
      },
    });

    const optionValue = await tx.optionValue.create({
      data: {
        shopId: shop.id,
        optionGroupId: optionGroup.id,
        label: "Polycarbonate",
        priceDeltaMinor: 0,
        currency: "USD",
        position: 0,
      },
    });

    const addOn = await tx.addOn.create({
      data: {
        shopId: shop.id,
        name: "Anti-fog",
        priceMinor: 1500,
        currency: "USD",
        position: 0,
      },
    });

    const prescription = await tx.prescription.create({
      data: {
        shopId: shop.id,
        rxType: "SINGLE_VISION",
        source: "MANUAL",
        cipher: "v1.fake-ciphertext-token",
        uploadKeys: [],
      },
    });

    await tx.labOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderId: "1001",
        orderName: "#1001",
        bundleId: "bundle-1",
        prescriptionId: prescription.id,
        lensId: lens.id,
        optionValueIds: [optionValue.id],
        addOnIds: [addOn.id],
        frameTitle: "Fixture frame",
        frameSku: "FRAME-1",
        rxOutOfLimits: false,
        status: "PENDING",
        attempts: 0,
        ticketKeys: [],
      },
    });

    await tx.complianceRequest.create({
      data: {
        shopId: shop.id,
        topic: "shop/redact",
        shopifyRequestId: `req_${shop.id}`,
        receivedAt: new Date("2026-01-15T00:00:00.000Z"),
      },
    });

    return shop.id;
  });

  return { shopId, domain };
}
