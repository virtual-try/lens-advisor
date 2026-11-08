import type { FullConfig } from "@playwright/test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { getPgbossSchemaTrackingFile, teardownSharedTestDb } from "./shared-db";
import { isStorefrontOnly } from "./global-setup";

export default async function globalTeardown(config?: FullConfig): Promise<void> {
  if (isStorefrontOnly(config)) {
    return;
  }

  const dbUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!dbUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for e2e database teardown, but it is unset."
    );
  }

  await teardownSharedTestDb();

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

  if (schemaToDrop && /^pgboss_e2e_[a-zA-Z0-9_]+$/.test(schemaToDrop)) {
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
