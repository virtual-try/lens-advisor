import { PgBoss } from "pg-boss";
import { getConfig } from "../config.server";
import { getJobDefinitions } from "../queue/define-job";
import { type Queue, createQueue } from "../queue/queue";
import { registerWebFeatureJobs } from "../queue/web-definitions.server";

export interface CreatePgBossOptions {
  connectionString: string;
  /** pg-boss schema. Defaults to `pgboss` (ARCHITECTURE.md#data-model). */
  schema?: string;
  /** Receives pg-boss `error` events. Defaults to logging the message (never job data). */
  onError?: (error: Error) => void;
}

/**
 * Constructs a PgBoss client instance. In accordance with ARCHITECTURE.md:144,
 * PgBoss is constructed ONLY inside `app/shared/container/` and injected into
 * the Queue adapter.
 */
export function createPgBoss(options: CreatePgBossOptions): PgBoss {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.schema ?? "pgboss",
    // Neon's pooler does not support LISTEN/NOTIFY; polling is the correctness floor.
    useListenNotify: false,
    application_name: "lens-advisor",
  });
  const onError =
    options.onError ?? ((error: Error) => console.error(`[queue] ${error.message}`));
  boss.on("error", onError);
  return boss;
}

let queuePromise: Promise<Queue> | undefined;

/**
 * Lazy composition-root getter for the web process's pg-boss queue. Imports the
 * feature job definitions through Vite's eager glob, registers every queue and
 * its dead-letter queue, then starts pg-boss in polling mode.
 */
export async function getQueue(): Promise<Queue> {
  if (!queuePromise) {
    queuePromise = (async () => {
      registerWebFeatureJobs();
      const boss = createPgBoss({
        connectionString: getConfig().database.databaseUrl,
        schema: "pgboss",
      });
      const queue = await createQueue(boss, {
        schema: "pgboss",
      });
      await queue.registerAll(getJobDefinitions());
      return queue;
    })();
    queuePromise.catch(() => {
      queuePromise = undefined;
    });
  }
  return queuePromise;
}

/** Test-only hook: stop the singleton and allow the next `getQueue()` to start fresh. */
export async function resetQueueForTest(): Promise<void> {
  const pending = queuePromise;
  queuePromise = undefined;
  if (!pending) return;
  const queue = await pending.catch(() => undefined);
  await queue?.destroy();
}
