import { createTestDb, type TestDb } from "../../test/db";

let sharedDb: TestDb | undefined;

export async function getSharedTestDb(): Promise<TestDb> {
  if (!sharedDb) {
    sharedDb = await createTestDb();
    (globalThis as Record<string, unknown>).__prismaClient = sharedDb.prisma;
  }
  return sharedDb;
}

export async function teardownSharedTestDb(): Promise<void> {
  if (sharedDb) {
    const dbToDrop = sharedDb;
    sharedDb = undefined;
    await dbToDrop.drop();
  }
}
