import "./shopify-mock";
import "./shopify-auth";
import { test, expect } from "@playwright/test";
import { setupQueueMock, teardownQueueMock } from "./queue-mock";
import { loadServerModule } from "./vite";
import { INTAKE_JOB_NAME } from "../../app/features/lab-orders/constants";

test.describe("Queue mock seam and run-scoped schema (R5-F1)", () => {
  test("successful enqueue captures job and records job id", async () => {
    await loadServerModule("./app/features/lab-orders/jobs.server.ts");
    const queueContainer = await loadServerModule<typeof import("../../app/shared/container/queue.server")>(
      "./app/shared/container/queue.server.ts"
    );
    const queue = await queueContainer.getQueue();

    const mockQueue = await setupQueueMock();
    try {
      const uniqueOrderId = `99901${Date.now()}`;
      const jobId = await queue.enqueue(INTAKE_JOB_NAME, {
        shopDomain: "queue-mock-test.myshopify.com",
        shopifyOrderId: uniqueOrderId,
      });

      expect(jobId).not.toBeNull();
      expect(typeof jobId).toBe("string");

      const captured = mockQueue.findJobs(INTAKE_JOB_NAME);
      expect(captured.length).toBe(1);
      expect(captured[0].jobId).toBe(jobId);
      expect(captured[0].payload).toEqual({
        shopDomain: "queue-mock-test.myshopify.com",
        shopifyOrderId: uniqueOrderId,
      });
    } finally {
      teardownQueueMock();
    }
  });

  test("deduped singleton enqueue returning null is not captured in mockQueue (R5-F1)", async () => {
    await loadServerModule("./app/features/lab-orders/jobs.server.ts");
    const queueContainer = await loadServerModule<typeof import("../../app/shared/container/queue.server")>(
      "./app/shared/container/queue.server.ts"
    );
    const queue = await queueContainer.getQueue();

    const mockQueue = await setupQueueMock();
    try {
      const fixedSingletonKey = `singleton-test-${Date.now()}`;
      // First enqueue succeeds and returns a string job id
      const firstJobId = await queue.enqueue(
        INTAKE_JOB_NAME,
        {
          shopDomain: "queue-mock-test.myshopify.com",
          shopifyOrderId: "11223344",
        },
        { singletonKey: fixedSingletonKey }
      );

      expect(firstJobId).not.toBeNull();
      expect(mockQueue.jobs.length).toBe(1);

      // Second enqueue with identical singleton key while first is queued returns null
      const secondJobId = await queue.enqueue(
        INTAKE_JOB_NAME,
        {
          shopDomain: "queue-mock-test.myshopify.com",
          shopifyOrderId: "11223344",
        },
        { singletonKey: fixedSingletonKey }
      );

      expect(secondJobId).toBeNull();
      // Crucial R5-F1 assertion: The deduped call MUST NOT be captured in mockQueue.jobs
      expect(mockQueue.jobs.length).toBe(1);
      expect(mockQueue.jobs[0].jobId).toBe(firstJobId);
    } finally {
      teardownQueueMock();
    }
  });

  test("runs pg-boss in the run-scoped schema from process.env.PGBOSS_SCHEMA (R5-F1)", async () => {
    const queueContainer = await loadServerModule<typeof import("../../app/shared/container/queue.server")>(
      "./app/shared/container/queue.server.ts"
    );
    const queue = await queueContainer.getQueue();

    expect(process.env.PGBOSS_SCHEMA).toBeDefined();
    expect(process.env.PGBOSS_SCHEMA).toMatch(/^pgboss_e2e_[a-zA-Z0-9_]+$/);
    expect(queue.schema).toBe(process.env.PGBOSS_SCHEMA);
  });
});
