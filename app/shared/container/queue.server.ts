import { getConfig } from "../config.server";
import { getJobDefinitions } from "../queue/define-job";
import { type Queue, createQueue } from "../queue/queue";
import { registerWebFeatureJobs } from "../queue/web-definitions.server";

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
      const queue = await createQueue({
        connectionString: getConfig().database.databaseUrl,
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
