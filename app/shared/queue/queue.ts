import { createHash } from "node:crypto";
import type {
  FindJobsOptions,
  JobWithMetadata,
  PgBoss,
  QueueResult,
  SendOptions,
} from "pg-boss";
import {
  type AnyJobDefinition,
  JobDefinitionError,
  JobPayloadValidationError,
  deadLetterQueueName,
  getJobDefinition,
  validateJobPayload,
  validateRetryOptions,
} from "./define-job";

export { JobDefinitionError, JobPayloadValidationError, validateRetryOptions };

export interface QueueOptions {
  /** pg-boss schema. Defaults to `pgboss` (ARCHITECTURE.md#data-model). */
  schema?: string;
  /** Idle poll interval, in seconds. pg-boss requires at least 0.5. */
  pollingIntervalSeconds?: number;
  localConcurrency?: number;
}

export type QueueConfig = QueueOptions;

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
}

const DEFAULT_SCHEMA = "pgboss";
const DEFAULT_POLLING_SECONDS = 2;

export interface QueueStopOptions {
  close?: boolean;
  graceful?: boolean;
  timeout?: number;
}

export class Queue {
  readonly schema: string;
  private readonly boss: PgBoss;
  private readonly config: ResolvedQueueConfig;
  private readonly registered = new Map<
    string,
    { retryLimit: number; retryDelay: number; retryBackoff: boolean }
  >();
  private started = false;

  constructor(boss: PgBoss, options: QueueOptions = {}) {
    this.boss = boss;
    this.schema = options.schema ?? DEFAULT_SCHEMA;
    this.config = {
      schema: this.schema,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS,
      localConcurrency: options.localConcurrency ?? 1,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  /**
   * Creates the job queue and its `<name>.dead` dead-letter queue, and reconciles
   * retry and dead-letter settings. Idempotent. The main queue uses the `exclusive`
   * policy so a duplicate singleton key is rejected while the first job is queued,
   * retrying or active.
   */
  async register(definition: AnyJobDefinition): Promise<void> {
    const cached = this.registered.get(definition.name);
    if (
      cached &&
      cached.retryLimit === definition.retry.retryLimit &&
      cached.retryDelay === definition.retry.retryDelay &&
      cached.retryBackoff === definition.retry.retryBackoff
    ) {
      return;
    }

    const deadLetter = deadLetterQueueName(definition.name);
    const existingDeadLetter = await this.boss.getQueue(deadLetter);
    const existingDeadLetterPolicy =
      existingDeadLetter?.policy ?? (existingDeadLetter ? "standard" : undefined);
    if (existingDeadLetter && existingDeadLetterPolicy !== "standard") {
      throw new JobDefinitionError(
        `Queue "${deadLetter}" has policy "${existingDeadLetterPolicy}" but expected "standard"`
      );
    }
    await this.boss.createQueue(deadLetter, { policy: "standard", retryLimit: 0 });
    await this.boss.updateQueue(deadLetter, { retryLimit: 0 });

    const expectedPolicy = "exclusive";
    const existing = await this.boss.getQueue(definition.name);
    const existingPolicy = existing?.policy ?? (existing ? "standard" : undefined);
    if (existing && existingPolicy !== expectedPolicy) {
      throw new JobDefinitionError(
        `Queue "${definition.name}" has policy "${existingPolicy}" but expected "${expectedPolicy}"`
      );
    }

    await this.boss.createQueue(definition.name, {
      policy: expectedPolicy,
      deadLetter,
      retryLimit: definition.retry.retryLimit,
      retryDelay: definition.retry.retryDelay,
      retryBackoff: definition.retry.retryBackoff,
    });
    await this.boss.updateQueue(definition.name, {
      deadLetter,
      retryLimit: definition.retry.retryLimit,
      retryDelay: definition.retry.retryDelay,
      retryBackoff: definition.retry.retryBackoff,
    });
    this.registered.set(definition.name, { ...definition.retry });
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

    validateRetryOptions(options);

    const parsed = validateJobPayload(definition, payload);
    await this.register(definition);

    const singletonKey = options.singletonKey ?? deriveSingletonKey(parsed);
    if (singletonKey.length === 0) {
      throw new JobDefinitionError("singletonKey must not be empty");
    }

    return this.boss.send(name, parsed as object, this.sendOptions(singletonKey, options));
  }

  async stop(options: QueueStopOptions = {}): Promise<void> {
    await this.boss.stop({
      close: options.close ?? true,
      graceful: options.graceful ?? true,
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });
    if (options.close ?? true) this.started = false;
  }

  /** Job metadata by queue name, including completed and dead-lettered copies. */
  async findJobs<T = object>(
    name: string,
    options: FindJobsOptions = {}
  ): Promise<JobWithMetadata<T>[]> {
    return this.boss.findJobs<T>(name, options);
  }

  /** Queue metadata and configuration from pg-boss. */
  async getQueue(name: string): Promise<QueueResult | null> {
    return this.boss.getQueue(name);
  }

  /**
   * Stops polling, waits for in-flight jobs, then optionally drops the pg-boss
   * schema. Tests use this so each file owns a throwaway schema.
   */
  async destroy(options: { dropSchema?: boolean; timeout?: number } = {}): Promise<void> {
    if (!this.started) return;
    if (options.dropSchema) {
      await this.boss.stop({
        graceful: true,
        close: false,
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      });
      if (!/^[a-zA-Z0-9_]+$/.test(this.schema)) {
        throw new Error(`Refusing to drop unexpected schema name "${this.schema}"`);
      }
      await this.boss.getDb().executeSql(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
      await this.boss.stop({
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      });
    } else {
      await this.stop({ graceful: true, close: true, timeout: options.timeout });
    }
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

export async function createQueue(boss: PgBoss, options: QueueOptions = {}): Promise<Queue> {
  const queue = new Queue(boss, options);
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
