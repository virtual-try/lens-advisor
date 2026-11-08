import type { EnqueueOptions, Queue as QueueType } from "../../app/shared/queue/queue";
import { Queue as NodeQueue } from "../../app/shared/queue/queue";
import { getViteServer } from "./vite";

try {
  // Hook pg-boss Attorney in Node so any direct pg-boss instances inherit run-scoped schema
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Attorney = require("pg-boss/dist/attorney.js") as {
    getConfig: (val: unknown) => { schema: string };
  };
  const origGetConfig = Attorney.getConfig;
  Attorney.getConfig = function (value: unknown) {
    const config = origGetConfig.call(this, value);
    if (process.env.PGBOSS_SCHEMA && config.schema === "pgboss") {
      config.schema = process.env.PGBOSS_SCHEMA;
    }
    return config;
  };
} catch {
  // Ignore if Attorney is not directly requireable
}

export interface CapturedQueueJob {
  name: string;
  payload: unknown;
  options?: EnqueueOptions;
  jobId?: string;
}

export interface MockQueue extends Pick<QueueType, "enqueue" | "registerAll" | "start" | "stop"> {
  jobs: CapturedQueueJob[];
  clear: () => void;
  findJob: (name: string) => CapturedQueueJob | undefined;
  findJobs: (name: string) => CapturedQueueJob[];
}

let activeTeardown: (() => void) | undefined;

/**
 * Creates an in-memory queue mock that captures enqueued jobs without touching
 * pg-boss or the database.
 */
export function createMockQueue(): MockQueue {
  const jobs: CapturedQueueJob[] = [];

  return {
    jobs,
    enqueue: async (name: string, payload: unknown, options?: EnqueueOptions) => {
      const jobId = `mock-job-${Date.now()}-${jobs.length}`;
      jobs.push({ name, payload, options, jobId });
      return jobId;
    },
    registerAll: async () => {},
    start: async () => {},
    stop: async () => {},
    clear: () => {
      jobs.length = 0;
    },
    findJob: (name: string) => jobs.find((j) => j.name === name),
    findJobs: (name: string) => jobs.filter((j) => j.name === name),
  };
}

/**
 * Installs the queue mock onto `globalThis.__queue` and intercepts enqueue calls
 * across both Node and Vite module runtimes to capture payloads and route them
 * to the real test database.
 * Only enqueues that successfully return a job id (non-null) are recorded.
 * Deduped singletons that return null are omitted from capture (R5-F1).
 */
export async function setupQueueMock(): Promise<MockQueue> {
  if (activeTeardown) {
    activeTeardown();
  }
  const mockQueue = createMockQueue();
  (globalThis as Record<string, unknown>).__queue = mockQueue;

  const origNodeEnqueue = NodeQueue.prototype.enqueue;
  NodeQueue.prototype.enqueue = async function (
    name: string,
    payload: unknown,
    options?: EnqueueOptions
  ) {
    const jobId = await origNodeEnqueue.apply(this, [name, payload, options] as [
      string,
      unknown,
      EnqueueOptions,
    ]);
    if (jobId !== null) {
      mockQueue.jobs.push({ name, payload, options, jobId });
    }
    return jobId;
  };

  const vite = await getViteServer();
  const viteQueueModule = (await vite.ssrLoadModule(
    "./app/shared/queue/queue.ts"
  )) as { Queue: typeof NodeQueue };
  const origViteEnqueue = viteQueueModule.Queue.prototype.enqueue;
  viteQueueModule.Queue.prototype.enqueue = async function (
    name: string,
    payload: unknown,
    options?: EnqueueOptions
  ) {
    const jobId = await origViteEnqueue.apply(this, [name, payload, options] as [
      string,
      unknown,
      EnqueueOptions,
    ]);
    if (jobId !== null) {
      mockQueue.jobs.push({ name, payload, options, jobId });
    }
    return jobId;
  };

  activeTeardown = () => {
    NodeQueue.prototype.enqueue = origNodeEnqueue;
    viteQueueModule.Queue.prototype.enqueue = origViteEnqueue;
    delete (globalThis as Record<string, unknown>).__queue;
    activeTeardown = undefined;
  };

  return mockQueue;
}

/**
 * Removes the queue mock and restores original enqueue methods.
 */
export function teardownQueueMock(): void {
  if (activeTeardown) {
    activeTeardown();
  }
}
