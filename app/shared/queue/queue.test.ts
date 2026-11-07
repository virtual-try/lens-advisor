import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJob } from "./define-job";
import { waitFor, withTestQueue } from "./test-support";

function jobName(prefix: string): string {
  return `test.${prefix}-${randomUUID()}`;
}

describe("Queue on a real Postgres", () => {
  it("enqueue twice with the same singletonKey creates one job (INV-8)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("singleton");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      });
      await queue.register(definition);

      const first = await queue.enqueue(name, { orderId: "order-1" }, { singletonKey: "order-1" });
      const second = await queue.enqueue(name, { orderId: "order-1" }, { singletonKey: "order-1" });

      expect(first).toEqual(expect.any(String));
      expect(second).toBeNull();
      expect(await queue.findJobs(name)).toHaveLength(1);
    });
  });

  it("retries a throwing handler and succeeds on the third attempt", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("retry");
      let attempts = 0;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 3, retryDelay: 0 },
        handler: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("transient failure");
        },
      });

      await queue.work(definition);
      await queue.enqueue(name, { orderId: "order-2" }, { singletonKey: "order-2" });

      const completed = await waitFor(
        async () => (await queue.findJobs(name))[0],
        (job) => job.state === "completed"
      );

      expect(attempts).toBe(3);
      expect(completed.retryCount).toBe(2);
      expect(await queue.findJobs(`${name}.dead`)).toHaveLength(0);
    });
  });

  it("moves a job that exhausts its retries to <name>.dead", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("dead");
      let attempts = 0;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 2, retryDelay: 0 },
        handler: async () => {
          attempts += 1;
          throw new Error("permanent failure");
        },
      });

      await queue.work(definition);
      await queue.enqueue(name, { orderId: "order-3" }, { singletonKey: "order-3" });

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      // pg-boss retryLimit counts retries after the first attempt.
      expect(attempts).toBe(3);
      expect(deadLetter.sourceName).toBe(name);
      expect(deadLetter.data).toEqual({ orderId: "order-3" });
    });
  });

  it("validates the payload on enqueue before writing a job", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("enqueue-invalid");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      });
      await queue.register(definition);

      await expect(
        queue.enqueue(name, { orderId: "order-4", rxText: "SPH -2.25" })
      ).rejects.toThrowError(/rxText/);
      expect(await queue.findJobs(name)).toHaveLength(0);
    });
  });

  it("validates the payload on receive and fails a legacy payload loudly", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("receive-invalid");
      let handlerCalled = false;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 0, retryDelay: 0 },
        handler: () => {
          handlerCalled = true;
        },
      });

      await queue.work(definition);
      // Models a job written by an older deploy whose payload the current schema rejects.
      await queue.enqueueRaw(name, { rxText: "SPH -2.25" }, { singletonKey: "legacy-1" });

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.data).toEqual({ rxText: "SPH -2.25" });
      expect(deadLetter.sourceName).toBe(name);
    });
  });

  it("rejects an unknown job name instead of sending it", async () => {
    await withTestQueue(async (queue) => {
      await expect(queue.enqueue("test.not-registered", {})).rejects.toThrowError(
        /Unknown job "test\.not-registered"/
      );
    });
  });
});
