import type { EnqueueOptions, Queue } from "../../app/shared/queue/queue";

export interface CapturedQueueJob {
  name: string;
  payload: unknown;
  options?: EnqueueOptions;
}

export interface MockQueue extends Pick<Queue, "enqueue" | "registerAll" | "start" | "stop"> {
  jobs: CapturedQueueJob[];
  clear: () => void;
  findJob: (name: string) => CapturedQueueJob | undefined;
  findJobs: (name: string) => CapturedQueueJob[];
}

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
 * Installs the queue mock onto `globalThis.__queue` (the queue test seam).
 */
export function setupQueueMock(): MockQueue {
  const mockQueue = createMockQueue();
  (globalThis as Record<string, unknown>).__queue = mockQueue;
  return mockQueue;
}

/**
 * Removes the queue mock from `globalThis.__queue`.
 */
export function teardownQueueMock(): void {
  delete (globalThis as Record<string, unknown>).__queue;
}
