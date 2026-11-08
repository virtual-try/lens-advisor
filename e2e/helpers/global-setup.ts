import type { FullConfig } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { getPgbossSchemaTrackingFile } from "./shared-db";

export function isStorefrontOnly(config?: FullConfig): boolean {
  if (config?.filteredProjects && config.filteredProjects.length > 0) {
    return config.filteredProjects.every((p) => p.name === "storefront");
  }
  if (config?.projects && config.projects.length > 0 && config.projects.every((p) => p.name === "storefront")) {
    return true;
  }
  const projectArgs = process.argv
    .filter((arg) => arg.startsWith("--project=") || arg === "--project")
    .map((arg, idx, arr) => {
      if (arg.startsWith("--project=")) {
        return arg.slice("--project=".length);
      }
      return arr[idx + 1];
    })
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (projectArgs.length > 0) {
    return projectArgs.every((name) => name === "storefront");
  }
  return false;
}

export default async function globalSetup(config?: FullConfig): Promise<void> {
  if (isStorefrontOnly(config)) {
    return;
  }

  const dbUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!dbUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for e2e database setup, but it is unset. " +
        "Ensure TEST_DATABASE_URL is defined before running server e2e tests."
    );
  }

  const pgbossSchema = process.env.PGBOSS_SCHEMA;
  if (pgbossSchema) {
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
