import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PgBoss, SendOptions } from "pg-boss";
import { PrismaClient } from "@prisma/client";
import { getTestDatabaseUrl } from "../config.server";
import { createPgBoss } from "../container/queue.server";
import { type Queue, createQueue } from "./queue";

/**
 * Vitest does not copy `.env` into environment variables; load it once for DB-backed
 * tests so the documented `pnpm test` command works on a fresh checkout.
 */
function loadLocalEnv(): void {
  const envFile = resolve(process.cwd(), ".env");
  if (typeof process.loadEnvFile === "function" && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

loadLocalEnv();

export function requireTestDatabaseUrl(): string {
  return getTestDatabaseUrl();
}

export function uniqueSchema(): string {
  return `t_queue_${randomUUID().replaceAll("-", "")}`;
}

export async function dropTestSchema(schema: string): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(`Refusing to drop unexpected schema name "${schema}"`);
  }
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: requireTestDatabaseUrl(),
      },
    },
  });
  try {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}

export async function testSchemaExists(schema: string): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: requireTestDatabaseUrl(),
      },
    },
  });
  try {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
      schema
    );
    return rows.length > 0;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Creates a throwaway pg-boss schema, runs the test against a real Postgres, then
 * stops polling and drops the schema. No rows are shared between tests.
 */
export async function withTestQueue(
  run: (queue: Queue, schema: string) => Promise<void>
): Promise<void> {
  const schema = uniqueSchema();
  const boss = createPgBoss({
    connectionString: requireTestDatabaseUrl(),
    schema,
    onError: () => undefined,
  });
  const queue = await createQueue(boss, {
    schema,
    pollingIntervalSeconds: 0.5,
  });

  try {
    await run(queue, schema);
  } finally {
    await queue.destroy({ dropSchema: true });
  }
}

export async function waitFor<T>(
  read: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  timeoutMs = 15000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined && predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

export interface EnqueueTestRawOptions {
  singletonKey?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

/**
 * Test-only helper to insert unvalidated or legacy payloads directly into
 * pg-boss without running enqueue-side validation (R1-F3).
 */
export async function enqueueTestRaw(
  queue: Queue,
  name: string,
  payload: object | null,
  options: EnqueueTestRawOptions = {}
): Promise<string | null> {
  const boss = (queue as unknown as { boss: PgBoss }).boss;
  const singletonKey = options.singletonKey ?? randomUUID();
  const sendOptions: SendOptions = { singletonKey };
  if (options.retryLimit !== undefined) sendOptions.retryLimit = options.retryLimit;
  if (options.retryDelay !== undefined) sendOptions.retryDelay = options.retryDelay;
  if (options.retryBackoff !== undefined) sendOptions.retryBackoff = options.retryBackoff;
  return boss.send(name, payload, sendOptions);
}
