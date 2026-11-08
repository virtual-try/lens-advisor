import type { EnqueueOptions, Queue as QueueType } from "../../app/shared/queue/queue";
import { Queue as NodeQueue } from "../../app/shared/queue/queue";
import { getViteServer } from "./vite";

export interface CapturedQueueJob {
  name: string;
  payload: unknown;
  options?: EnqueueOptions;
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
      jobs.push({ name, payload, options });
      return `mock-job-${Date.now()}-${jobs.length}`;
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
    mockQueue.jobs.push({ name, payload, options });
    return origNodeEnqueue.apply(this, [name, payload, options] as [
      string,
      unknown,
      EnqueueOptions,
    ]);
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
    mockQueue.jobs.push({ name, payload, options });
    return origViteEnqueue.apply(this, [name, payload, options] as [
      string,
      unknown,
      EnqueueOptions,
    ]);
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
