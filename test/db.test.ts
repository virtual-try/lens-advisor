import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestSchema,
  deployMigrations,
  seedShop,
  type TestDb,
} from "./db";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

const EXEMPT_MODELS = new Set(["Shop", "Session"]);

const RX_VALUE_NAME = /^(sph|cyl|axis|add|pd)(?![a-z])/i;
const DIOPTER_NAME = /^(sph|cyl|add)(Min|Max)$/;
const MONEY_NAME = /Minor$/;

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

  it("gives Prescription no plaintext Rx field and stores cipher as text", () => {
    const prescription = models().find((model) => model.name === "Prescription");
    expect(prescription).toBeDefined();
    const names = prescription?.fields.map((field) => field.name) ?? [];
    const rxFields = names.filter((name) => RX_VALUE_NAME.test(name));
    expect(rxFields).toEqual([]);

    const cipher = prescription?.fields.find((field) => field.name === "cipher");
    expect(cipher?.type).toBe("String");
    expect(cipher?.nativeType).toEqual(["Text", []]);
  });

  it("has no Float or Decimal fields, and money and diopters are integers", () => {
    const floats: string[] = [];
    for (const model of models()) {
      for (const field of model.fields) {
        if (field.type === "Float" || field.type === "Decimal") {
          floats.push(`${model.name}.${field.name}`);
        }
        if (MONEY_NAME.test(field.name)) {
          expect(field.type, `${model.name}.${field.name}`).toBe("Int");
        }
        if (DIOPTER_NAME.test(field.name)) {
          expect(field.type, `${model.name}.${field.name}`).toBe("Int");
        }
        if (field.name === "currency") {
          expect(field.type, `${model.name}.currency`).toBe("String");
          expect(field.nativeType, `${model.name}.currency`).toEqual([
            "VarChar",
            ["3"],
          ]);
        }
      }
    }
    expect(floats).toEqual([]);

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

  it("applies migrate deploy to an empty schema and to one that already holds a template session", async () => {
    const empty = await open();
    expect(await empty.prisma.session.count()).toBe(0);
    expect(await empty.prisma.shop.count()).toBe(0);

    const holding = await createTestSchema();
    const client = new PrismaClient({
      datasources: { db: { url: holding.url } },
    });
    try {
      const migration = readFileSync(
        path.join(
          repoRoot,
          "prisma",
          "migrations",
          "20261107120000_init",
          "migration.sql",
        ),
        "utf8",
      );
      const sessionSql = migration.match(
        /CREATE TABLE IF NOT EXISTS "Session" \([\s\S]*?\);/,
      );
      if (!sessionSql) {
        throw new Error("Session statement missing from the init migration");
      }
      await client.$executeRawUnsafe(sessionSql[0]);
      await client.$executeRaw`
        INSERT INTO "Session" ("id", "shop", "state", "isOnline", "accessToken", "accountOwner")
        VALUES ('template-session', 'template.myshopify.com', 'state', false, 'fake-token', false)
      `;
      // migrate deploy refuses a non-empty schema that has no migration table (P3005).
      // An empty _prisma_migrations table is the bookkeeping Prisma needs before it
      // will execute the pending init SQL. No migration is marked applied.
      await client.$executeRawUnsafe(`
        CREATE TABLE "_prisma_migrations" (
          "id" VARCHAR(36) PRIMARY KEY NOT NULL,
          "checksum" VARCHAR(64) NOT NULL,
          "finished_at" TIMESTAMPTZ,
          "migration_name" VARCHAR(255) NOT NULL,
          "logs" TEXT,
          "rolled_back_at" TIMESTAMPTZ,
          "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        )
      `);
      await deployMigrations(holding.url);

      const kept = await client.session.findUnique({
        where: { id: "template-session" },
      });
      expect(kept?.shop).toBe("template.myshopify.com");
      expect(kept?.accessToken).toBe("fake-token");
      expect(await client.shop.count()).toBe(0);
      expect(await currentSchema(client)).toBe(holding.schema);
    } finally {
      await client.$disconnect();
      await holding.drop();
    }
  });
});
