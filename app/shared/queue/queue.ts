import { createHash } from "node:crypto";
import { PgBoss, type FindJobsOptions, type JobWithMetadata, type SendOptions } from "pg-boss";
import {
  type AnyJobDefinition,
  JobDefinitionError,
  deadLetterQueueName,
  getJobDefinition,
  validateJobPayload,
} from "./define-job";

export interface QueueConfig {
  connectionString: string;
  /** pg-boss schema. Defaults to `pgboss` (ARCHITECTURE.md#data-model). */
  schema?: string;
  /** Idle poll interval, in seconds. pg-boss requires at least 0.5. */
  pollingIntervalSeconds?: number;
  localConcurrency?: number;
  /** Receives pg-boss `error` events. Defaults to logging the message (never job data). */
  onError?: (error: Error) => void;
}

export interface EnqueueOptions {
  /**
   * Dedupe key. A second enqueue with the same key while the first is queued or
   * active is dropped (pg-boss `exclusive` queue policy) and resolves to null.
   * When omitted, a deterministic key is derived from the validated payload so
   * an identical duplicate enqueue is also dropped. INV-8.
   */
  singletonKey?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

interface ResolvedQueueConfig {
  schema: string;
  pollingIntervalSeconds: number;
  localConcurrency: number;
  onError: (error: Error) => void;
}

const DEFAULT_SCHEMA = "pgboss";
const DEFAULT_POLLING_SECONDS = 2;

export class Queue {
  readonly schema: string;
  private readonly boss: PgBoss;
  private readonly config: ResolvedQueueConfig;
  private readonly registered = new Set<string>();
  private started = false;

  constructor(boss: PgBoss, config: ResolvedQueueConfig) {
    this.boss = boss;
    this.config = config;
    this.schema = config.schema;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  /**
   * Creates the job queue and its `<name>.dead` dead-letter queue. Idempotent.
   * The main queue uses the `exclusive` policy so a duplicate singleton key is
   * rejected while the first job is queued, retrying or active.
   */
  async register(definition: AnyJobDefinition): Promise<void> {
    if (this.registered.has(definition.name)) return;

    const deadLetter = deadLetterQueueName(definition.name);
    await this.boss.createQueue(deadLetter, { policy: "standard", retryLimit: 0 });
    await this.boss.createQueue(definition.name, {
      policy: "exclusive",
      deadLetter,
      retryLimit: definition.retry.retryLimit,
      retryDelay: definition.retry.retryDelay,
      retryBackoff: definition.retry.retryBackoff,
    });
    this.registered.add(definition.name);
  }

  async registerAll(definitions: readonly AnyJobDefinition[]): Promise<void> {
    for (const definition of definitions) {
      await this.register(definition);
    }
  }

  /**
   * Registers a pg-boss worker for one job. The payload is parsed through the
   * job's zod schema on receive as well as on enqueue; a payload written by an
   * older deploy fails the job loudly instead of reaching the handler.
   */
  async work(definition: AnyJobDefinition): Promise<string> {
    await this.register(definition);

    return this.boss.work(
      definition.name,
      {
        batchSize: 1,
        pollingIntervalSeconds: this.config.pollingIntervalSeconds,
        localConcurrency: this.config.localConcurrency,
      },
      async (jobs) => {
        for (const job of jobs) {
          const payload = validateJobPayload(definition, job.data);
          const handler = definition.handler as (
            payload: unknown,
            context: { jobId: string; retryCount: number; signal: AbortSignal }
          ) => Promise<void> | void;
          await handler(payload, {
            jobId: job.id,
            retryCount: job.retryCount,
            signal: job.signal,
          });
        }
      }
    );
  }

  async enqueue(
    name: string,
    payload: unknown,
    options: EnqueueOptions = {}
  ): Promise<string | null> {
    const definition = getJobDefinition(name);
    if (!definition) {
      throw new JobDefinitionError(
        `Unknown job "${name}"; import the feature's jobs.server.ts before enqueuing`
      );
    }

    const parsed = validateJobPayload(definition, payload);
    await this.register(definition);

    const singletonKey = options.singletonKey ?? deriveSingletonKey(parsed);
    if (singletonKey.length === 0) {
      throw new JobDefinitionError("singletonKey must not be empty");
    }

    return this.boss.send(name, parsed as object, this.sendOptions(singletonKey, options));
  }

  /**
   * Raw pg-boss send for replaying jobs written by an older deploy and for the
   * receive-validation test. Application code uses `enqueue`.
   */
  async enqueueRaw(
    name: string,
    payload: object | null,
    options: EnqueueOptions = {}
  ): Promise<string | null> {
    if (!this.registered.has(name)) {
      throw new JobDefinitionError(`Queue "${name}" has not been registered`);
    }
    const singletonKey = options.singletonKey ?? deriveSingletonKey(payload);
    return this.boss.send(name, payload, this.sendOptions(singletonKey, options));
  }

  async stop(options: { close?: boolean; graceful?: boolean } = {}): Promise<void> {
    await this.boss.stop({ close: options.close ?? true, graceful: options.graceful ?? true });
    if (options.close ?? true) this.started = false;
  }

  /** Job metadata by queue name, including completed and dead-lettered copies. */
  async findJobs<T = object>(
    name: string,
    options: FindJobsOptions = {}
  ): Promise<JobWithMetadata<T>[]> {
    return this.boss.findJobs<T>(name, options);
  }

  /**
   * Stops polling, waits for in-flight jobs, then optionally drops the pg-boss
   * schema. Tests use this so each file owns a throwaway schema.
   */
  async destroy(options: { dropSchema?: boolean } = {}): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, close: false });
    if (options.dropSchema) {
      if (!/^[a-zA-Z0-9_]+$/.test(this.schema)) {
        throw new Error(`Refusing to drop unexpected schema name "${this.schema}"`);
      }
      await this.boss.getDb().executeSql(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
    }
    await this.boss.stop();
    this.started = false;
  }

  private sendOptions(singletonKey: string, options: EnqueueOptions): SendOptions {
    const sendOptions: SendOptions = { singletonKey };
    if (options.retryLimit !== undefined) sendOptions.retryLimit = options.retryLimit;
    if (options.retryDelay !== undefined) sendOptions.retryDelay = options.retryDelay;
    if (options.retryBackoff !== undefined) sendOptions.retryBackoff = options.retryBackoff;
    return sendOptions;
  }
}

export async function createQueue(config: QueueConfig): Promise<Queue> {
  const resolved: ResolvedQueueConfig = {
    schema: config.schema ?? DEFAULT_SCHEMA,
    pollingIntervalSeconds: config.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS,
    localConcurrency: config.localConcurrency ?? 1,
    onError: config.onError ?? ((error) => console.error(`[queue] ${error.message}`)),
  };

  const boss = new PgBoss({
    connectionString: config.connectionString,
    schema: resolved.schema,
    // Neon's pooler does not support LISTEN/NOTIFY; polling is the correctness floor.
    useListenNotify: false,
    application_name: "lens-advisor",
  });
  boss.on("error", (error: Error) => resolved.onError(error));

  const queue = new Queue(boss, resolved);
  await queue.start();
  return queue;
}

function deriveSingletonKey(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
