import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createTestDb, type TestDb } from "../../test/db";

const SCHEMA_FILE = path.join(tmpdir(), "lens-advisor-e2e-schema.txt");

let sharedDb: TestDb | undefined;

export async function getSharedTestDb(): Promise<TestDb> {
  if (!sharedDb) {
    sharedDb = await createTestDb();
    (globalThis as Record<string, unknown>).__prismaClient = sharedDb.prisma;
    process.env.DATABASE_URL = sharedDb.url;
    try {
      writeFileSync(SCHEMA_FILE, sharedDb.schema, "utf8");
    } catch {
      // Ignore write errors to temp directory
    }
  }
  return sharedDb;
}

export async function resetSharedTestDb(): Promise<void> {
  const db = await getSharedTestDb();
  await db.prisma.complianceRequest.deleteMany();
  await db.prisma.labOrder.deleteMany();
  await db.prisma.prescription.deleteMany();
  await db.prisma.addOn.deleteMany();
  await db.prisma.optionValue.deleteMany();
  await db.prisma.optionGroup.deleteMany();
  await db.prisma.lens.deleteMany();
  await db.prisma.lensGroup.deleteMany();
  await db.prisma.shopSettings.deleteMany();
  await db.prisma.shop.deleteMany();
  await db.prisma.session.deleteMany();
}

export async function teardownSharedTestDb(): Promise<void> {
  if (sharedDb) {
    const dbToDrop = sharedDb;
    sharedDb = undefined;
    await dbToDrop.drop();
  }

  if (existsSync(SCHEMA_FILE)) {
    try {
      const schema = readFileSync(SCHEMA_FILE, "utf8").trim();
      if (/^t_[0-9a-f]{16}$/.test(schema)) {
        const baseUrl = process.env.TEST_DATABASE_URL?.trim();
        if (baseUrl) {
          const client = new PrismaClient({
            datasources: { db: { url: baseUrl } },
          });
          try {
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          } finally {
            await client.$disconnect();
          }
        }
      }
    } catch (err) {
      console.warn("[e2e] Failed to drop schema from temp file:", err);
    } finally {
      try {
        unlinkSync(SCHEMA_FILE);
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
