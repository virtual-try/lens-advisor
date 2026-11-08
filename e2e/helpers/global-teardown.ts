import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { getPgbossSchemaTrackingFile, teardownSharedTestDb } from "./shared-db";

export default async function globalTeardown(): Promise<void> {
  await teardownSharedTestDb();

  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const trackingFile = getPgbossSchemaTrackingFile();
  let schemaToDrop = process.env.PGBOSS_SCHEMA;

  if (existsSync(trackingFile)) {
    try {
      const tracked = readFileSync(trackingFile, "utf8").trim();
      if (/^pgboss_e2e_[a-zA-Z0-9_]+$/.test(tracked)) {
        schemaToDrop = tracked;
      }
    } catch {
      // Ignore read errors
    } finally {
      try {
        unlinkSync(trackingFile);
      } catch {
        // Ignore unlink errors
      }
    }
  }

  if (dbUrl && schemaToDrop && /^pgboss_e2e_[a-zA-Z0-9_]+$/.test(schemaToDrop)) {
    const client = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    try {
      await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaToDrop}" CASCADE`);
    } catch (err) {
      console.warn("[e2e] Failed to drop pg-boss schema:", err);
    } finally {
      await client.$disconnect();
    }
  }
}
