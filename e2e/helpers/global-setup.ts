import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { getPgbossSchemaTrackingFile } from "./shared-db";

export default async function globalSetup(): Promise<void> {
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const pgbossSchema = process.env.PGBOSS_SCHEMA;

  if (dbUrl && pgbossSchema) {
    try {
      writeFileSync(getPgbossSchemaTrackingFile(), pgbossSchema, "utf8");
    } catch {
      // Ignore write errors to temp directory
    }

    if (/^pgboss_e2e_[a-zA-Z0-9_]+$/.test(pgbossSchema)) {
      const client = new PrismaClient({
        datasources: { db: { url: dbUrl } },
      });
      try {
        await client.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${pgbossSchema}"`);
      } finally {
        await client.$disconnect();
      }
    }
  }
}
