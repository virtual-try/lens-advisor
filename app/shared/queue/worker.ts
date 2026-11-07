import { getConfig } from "../config.server";
import { discoverJobs } from "./discovery.server";
import { createQueue } from "./queue";

export interface WorkerCliOptions {
  featuresDir?: string;
  schema?: string;
  /** Overrides the configured DATABASE_URL. Used by the worker process test only. */
  databaseUrl?: string;
  pollingIntervalSeconds?: number;
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

export function parseWorkerCliOptions(argv: readonly string[]): WorkerCliOptions {
  const options: WorkerCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected worker argument "${flag}"`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Worker argument "${flag}" needs a value`);
    }
    index += 1;

    switch (flag) {
      case "--features-dir":
        options.featuresDir = value;
        break;
      case "--schema":
        options.schema = value;
        break;
      case "--database-url":
        options.databaseUrl = value;
        break;
      case "--polling-interval": {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 0.5) {
          throw new Error("--polling-interval must be a number of seconds >= 0.5");
        }
        options.pollingIntervalSeconds = seconds;
        break;
      }
      default:
        throw new Error(`Unknown worker argument "${flag}"`);
    }
  }

  return options;
}

/**
 * Starts the worker process: discover every `features/<feature>/jobs.server.ts`,
 * create its queue and dead-letter queue, register its handler, then install a
 * graceful SIGTERM/SIGINT shutdown that finishes in-flight work and stops polling.
 */
export async function runWorker(argv: readonly string[] = []): Promise<WorkerHandle> {
  const options = parseWorkerCliOptions(argv);
  const config = getConfig();
  const connectionString = options.databaseUrl ?? config.database.databaseUrl;

  const definitions = await discoverJobs(options.featuresDir);
  const queue = await createQueue({
    connectionString,
    schema: options.schema ?? "pgboss",
    pollingIntervalSeconds: options.pollingIntervalSeconds,
  });

  await queue.registerAll(definitions);
  for (const definition of definitions) {
    await queue.work(definition);
  }

  console.log(
    `[worker] ready with ${definitions.length} job(s): ${definitions
      .map((definition) => definition.name)
      .join(", ")}`
  );

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      await queue.destroy();
      console.log("[worker] stopped");
    })();
    return stopping;
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    console.log(`[worker] ${signal} received, finishing in-flight work`);
    stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(
          `[worker] shutdown failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      });
  };
  const onSigterm = (): void => onSignal("SIGTERM");
  const onSigint = (): void => onSignal("SIGINT");

  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  return { stop };
}
