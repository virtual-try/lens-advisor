import { Prisma, PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestSchema,
  deployMigrations,
  markMigrationApplied,
  pushTemplateSession,
  seedShop,
  SESSION_BASELINE_MIGRATION,
  type TestDb,
} from "./db";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

const EXEMPT_MODELS = new Set(["Shop", "Session"]);

const DIOPTER_NAME = /^(sph|cyl|add)(Min|Max)$/;
const MONEY_NAME = /Minor$/;

/** Scalar columns. Relations are not stored. Adding any other name fails INV-2. */
const PRESCRIPTION_COLUMNS = [
  "cipher",
  "createdAt",
  "id",
  "orderId",
  "rxType",
  "shopId",
  "source",
  "uploadKeys",
];

type ShopCounter = {
  count(args?: { where?: { shopId?: string } }): Promise<number>;
};

function models(): DmmfModel[] {
  return [...Prisma.dmmf.datamodel.models];
}

function shopOwnedModels(): DmmfModel[] {
  return models().filter((model) => !EXEMPT_MODELS.has(model.name));
}

function shopIdField(model: DmmfModel) {
  return model.fields.find(
    (field) => field.name === "shopId" && field.kind === "scalar",
  );
}

function shopRelation(model: DmmfModel) {
  return model.fields.find(
    (field) => field.kind === "object" && field.type === "Shop",
  );
}

/** Client DMMF keeps unique indexes and `isId`, and drops non-unique @@index. */
function hasShopLeadingIndex(model: DmmfModel): boolean {
  const shopId = shopIdField(model);
  if (!shopId) return false;
  if (shopId.isId) return true;
  return (
    model.uniqueIndexes.some((index) => index.fields[0] === "shopId") ||
    model.uniqueFields.some((fields) => fields[0] === "shopId")
  );
}

function delegateName(modelName: string): string {
  return modelName.slice(0, 1).toLowerCase() + modelName.slice(1);
}

/** Line comments removed. These migrations have no semicolons inside literals. */
function sqlStatements(source: string): string[] {
  const stripped = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return stripped
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function migrationSqlFiles(): string[] {
  const root = path.join(repoRoot, "prisma", "migrations");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "migration.sql"))
    .sort();
}

/** A failure before COMMIT must not commit the earlier statements. */
function sabotage(statements: string[]): string[] {
  const next = [...statements];
  const commitAt = next.lastIndexOf("COMMIT");
  const insertAt = commitAt === -1 ? next.length : commitAt;
  next.splice(insertAt, 0, "SELECT 1/0");
  return next;
}

/**
 * Honors a leading BEGIN and a trailing COMMIT. Without that pair, each
 * statement autocommits, which is the partial-migration failure mode.
 */
async function applyMigrationStatements(
  prisma: PrismaClient,
  statements: string[],
): Promise<void> {
  const transactional =
    statements[0] === "BEGIN" && statements[statements.length - 1] === "COMMIT";
  const body = transactional ? statements.slice(1, -1) : statements;
  if (!transactional) {
    for (const statement of body) {
      await prisma.$executeRawUnsafe(statement);
    }
    return;
  }
  await prisma.$transaction(async (tx) => {
    for (const statement of body) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

function counter(prisma: PrismaClient, modelName: string): ShopCounter {
  const key = delegateName(modelName);
  const record = prisma as unknown as Record<string, ShopCounter | undefined>;
  const found = record[key];
  if (!found) {
    throw new Error(`Prisma client has no delegate for ${modelName}`);
  }
  return found;
}

async function currentSchema(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ schema: string }>>`
    SELECT current_schema() AS schema
  `;
  const schema = rows[0]?.schema;
  if (!schema) {
    throw new Error("current_schema() returned no row");
  }
  return schema;
}

describe("Prisma DMMF", () => {
  it("requires shopId, a shop cascade, and a shop-leading index on every shop-owned model", () => {
    const owned = shopOwnedModels();
    expect(owned.length).toBeGreaterThan(0);

    for (const model of owned) {
      const shopId = shopIdField(model);
      expect(shopId, model.name).toBeDefined();
      expect(shopId?.isRequired, `${model.name}.shopId`).toBe(true);
      expect(hasShopLeadingIndex(model), `${model.name} index`).toBe(true);

      const relation = shopRelation(model);
      expect(relation?.relationFromFields, model.name).toEqual(["shopId"]);
      expect(relation?.relationOnDelete, model.name).toBe("Cascade");
    }

    for (const name of EXEMPT_MODELS) {
      expect(models().some((model) => model.name === name)).toBe(true);
    }
  });

  it("limits Prescription to cipher, metadata, ids, and timestamps", () => {
    const prescription = models().find((model) => model.name === "Prescription");
    expect(prescription).toBeDefined();
    const columns =
      prescription?.fields
        .filter((field) => field.kind !== "object")
        .map((field) => field.name)
        .sort() ?? [];
    expect(columns).toEqual(PRESCRIPTION_COLUMNS);

    const cipher = prescription?.fields.find((field) => field.name === "cipher");
    expect(cipher?.type).toBe("String");
    expect(cipher?.nativeType).toEqual(["Text", []]);
  });

  it("has no Float or Decimal fields, and every money field has a currency code", () => {
    const floats: string[] = [];
    const moneyFields: string[] = [];
    for (const model of models()) {
      const currency = model.fields.find((field) => field.name === "currency");
      for (const field of model.fields) {
        if (field.type === "Float" || field.type === "Decimal") {
          floats.push(`${model.name}.${field.name}`);
        }
        if (MONEY_NAME.test(field.name)) {
          moneyFields.push(`${model.name}.${field.name}`);
          expect(field.type, `${model.name}.${field.name}`).toBe("Int");
          expect(currency, `${model.name}.${field.name} currency`).toMatchObject({
            kind: "scalar",
            type: "String",
            isRequired: true,
            nativeType: ["VarChar", ["3"]],
          });
        }
        if (DIOPTER_NAME.test(field.name)) {
          expect(field.type, `${model.name}.${field.name}`).toBe("Int");
        }
      }
    }
    expect(floats).toEqual([]);
    expect(moneyFields).toEqual([
      "Lens.priceMinor",
      "OptionValue.priceDeltaMinor",
      "AddOn.priceMinor",
    ]);

    const settings = models().find((model) => model.name === "ShopSettings");
    const storeRx = settings?.fields.find(
      (field) => field.name === "storeRxInOrder",
    );
    expect(storeRx?.type).toBe("Boolean");
    expect(storeRx?.hasDefaultValue).toBe(true);
    expect(storeRx?.default).toBe(false);
  });
});

describe("createTestDb", () => {
  const opened: TestDb[] = [];

  afterAll(async () => {
    await Promise.all(opened.map((db) => db.drop()));
  });

  async function open(): Promise<TestDb> {
    const db = await createTestDb();
    opened.push(db);
    return db;
  }

  it("gives two calls isolated schemas and keeps rows out of public", async () => {
    const [first, second] = await Promise.all([open(), open()]);
    expect(first.schema).not.toBe(second.schema);
    expect(await currentSchema(first.prisma)).toBe(first.schema);
    expect(await currentSchema(second.prisma)).toBe(second.schema);

    await seedShop(first.prisma, "alpha.myshopify.com");
    expect(await second.prisma.shop.findMany()).toEqual([]);
    expect(await first.prisma.shop.count()).toBe(1);

    const publicShops = await first.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Shop'
    `;
    expect(Number(publicShops[0]?.count)).toBe(0);
  });

  it("cascades a Shop delete through every shop-owned model from the DMMF", async () => {
    const db = await open();
    const seeded = await seedShop(db.prisma, "cascade.myshopify.com");
    await db.prisma.session.create({
      data: {
        id: "template-session",
        shop: "cascade.myshopify.com",
        state: "state",
        accessToken: "fake-token",
      },
    });

    const owned = shopOwnedModels();
    expect(owned.length).toBeGreaterThan(0);
    for (const model of owned) {
      const count = await counter(db.prisma, model.name).count({
        where: { shopId: seeded.shopId },
      });
      expect(count, `${model.name} seeded`).toBeGreaterThan(0);
    }

    await db.prisma.shop.delete({ where: { id: seeded.shopId } });

    for (const model of owned) {
      const count = await counter(db.prisma, model.name).count();
      expect(count, `${model.name} after shop delete`).toBe(0);
    }

    const session = await db.prisma.session.findUnique({
      where: { id: "template-session" },
    });
    expect(session?.accessToken).toBe("fake-token");
  });

  it("deploys onto an empty schema, and baselines a template Session database before deploy", async () => {
    const empty = await open();
    expect(await empty.prisma.session.count()).toBe(0);
    expect(await empty.prisma.shop.count()).toBe(0);

    const holding = await createTestSchema();
    const client = new PrismaClient({
      datasources: { db: { url: holding.url } },
    });
    try {
      await pushTemplateSession(holding.url);
      const history = await client.$queryRaw<Array<{ rel: string | null }>>`
        SELECT to_regclass('"_prisma_migrations"')::text AS rel
      `;
      expect(history[0]?.rel).toBeNull();

      await client.$executeRaw`
        INSERT INTO "Session" ("id", "shop", "state", "isOnline", "accessToken", "accountOwner")
        VALUES ('template-session', 'template.myshopify.com', 'state', false, 'fake-token', false)
      `;

      await markMigrationApplied(holding.url, SESSION_BASELINE_MIGRATION);
      const shopBeforeDeploy = await client.$queryRaw<Array<{ rel: string | null }>>`
        SELECT to_regclass('"Shop"')::text AS rel
      `;
      expect(shopBeforeDeploy[0]?.rel).toBeNull();

      await deployMigrations(holding.url);

      const kept = await client.session.findUnique({
        where: { id: "template-session" },
      });
      expect(kept?.shop).toBe("template.myshopify.com");
      expect(kept?.accessToken).toBe("fake-token");
      expect(await client.shop.count()).toBe(0);
      expect(await currentSchema(client)).toBe(holding.schema);

      const applied = await client.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name
        FROM "_prisma_migrations"
        ORDER BY migration_name
      `;
      expect(applied.map((row) => row.migration_name)).toEqual([
        SESSION_BASELINE_MIGRATION,
        "20261107120000_init",
      ]);
    } finally {
      await client.$disconnect();
      await holding.drop();
    }
  });
});

describe("migration transactions", () => {
  it("wraps every migration in one BEGIN/COMMIT transaction", () => {
    const files = migrationSqlFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const label = path.relative(repoRoot, file);
      const statements = sqlStatements(readFileSync(file, "utf8"));
      expect(statements[0], label).toBe("BEGIN");
      expect(statements[statements.length - 1], label).toBe("COMMIT");
      const control = statements.filter(
        (statement) =>
          statement === "BEGIN" ||
          statement === "COMMIT" ||
          statement === "ROLLBACK",
      );
      expect(control, label).toEqual(["BEGIN", "COMMIT"]);
    }
  });

  it("rolls the baseline back when a statement fails before COMMIT", async () => {
    const file = path.join(
      repoRoot,
      "prisma",
      "migrations",
      SESSION_BASELINE_MIGRATION,
      "migration.sql",
    );
    const holding = await createTestSchema();
    const client = new PrismaClient({
      datasources: { db: { url: holding.url } },
    });
    try {
      await expect(
        applyMigrationStatements(
          client,
          sabotage(sqlStatements(readFileSync(file, "utf8"))),
        ),
      ).rejects.toThrow();

      const session = await client.$queryRaw<Array<{ rel: string | null }>>`
        SELECT to_regclass('"Session"')::text AS rel
      `;
      expect(session[0]?.rel).toBeNull();
    } finally {
      await client.$disconnect();
      await holding.drop();
    }
  });
});
