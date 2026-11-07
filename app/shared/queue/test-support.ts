import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getTestDatabaseUrl } from "../config.server";
import { type Queue, createQueue } from "./queue";

/**
 * Vitest does not copy `.env` into `process.env`; load it once for DB-backed
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

/**
 * Creates a throwaway pg-boss schema, runs the test against a real Postgres, then
 * stops polling and drops the schema. No rows are shared between tests.
 */
export async function withTestQueue(
  run: (queue: Queue, schema: string) => Promise<void>
): Promise<void> {
  const schema = uniqueSchema();
  const queue = await createQueue({
    connectionString: requireTestDatabaseUrl(),
    schema,
    pollingIntervalSeconds: 0.5,
    onError: () => undefined,
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
