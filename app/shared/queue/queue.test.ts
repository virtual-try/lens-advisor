import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPgBoss } from "../container/queue.server";
import { clearJobRegistry, defineJob } from "./define-job";
import { Queue } from "./queue";
import { enqueueTestRaw, requireTestDatabaseUrl, uniqueSchema, waitFor, withTestQueue } from "./test-support";

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

      // Two different payloads with the same explicit singletonKey -> deduplicated to 1 job
      const first = await queue.enqueue(
        name,
        { orderId: "order-diff-1" },
        { singletonKey: "shared-key" }
      );
      const second = await queue.enqueue(
        name,
        { orderId: "order-diff-2" },
        { singletonKey: "shared-key" }
      );

      expect(first).toEqual(expect.any(String));
      expect(second).toBeNull();
      expect(await queue.findJobs(name)).toHaveLength(1);

      // Two identical payloads with different explicit singletonKeys -> two jobs created
      const third = await queue.enqueue(
        name,
        { orderId: "order-same" },
        { singletonKey: "key-a" }
      );
      const fourth = await queue.enqueue(
        name,
        { orderId: "order-same" },
        { singletonKey: "key-b" }
      );

      expect(third).toEqual(expect.any(String));
      expect(fourth).toEqual(expect.any(String));
      expect(third).not.toBe(fourth);
      expect(await queue.findJobs(name)).toHaveLength(3);
    });
  });

  it("retries a throwing handler and succeeds on the fifth attempt with retryLimit 4 (R2-F4)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("retry");
      let attempts = 0;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 4, retryDelay: 0 },
        handler: async () => {
          attempts += 1;
          if (attempts < 5) throw new Error("transient failure");
        },
      });

      await queue.work(definition);
      await queue.enqueue(name, { orderId: "order-retry" }, { singletonKey: "order-retry" });

      const completed = await waitFor(
        async () => (await queue.findJobs(name))[0],
        (job) => job.state === "completed"
      );

      expect(attempts).toBe(5);
      expect(completed.retryCount).toBe(4);
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
      await enqueueTestRaw(queue, name, { rxText: "SPH -2.25" }, { singletonKey: "legacy-1" });

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.data).toEqual({ rxText: "SPH -2.25" });
      expect(deadLetter.sourceName).toBe(name);
    });
  });

  it("fails a payload with unexpected keys on receive and moves it to <name>.dead (R1-F4)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("receive-extra-key");
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
      await enqueueTestRaw(
        queue,
        name,
        { orderId: "order-legacy-1", rxText: "SPH -2.25" },
        { singletonKey: "legacy-extra-1" }
      );

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.data).toEqual({ orderId: "order-legacy-1", rxText: "SPH -2.25" });
      expect(deadLetter.sourceName).toBe(name);
    });
  });

  it("does not expose enqueueRaw on the production Queue class (R1-F3)", async () => {
    await withTestQueue(async (queue) => {
      expect((queue as unknown as Record<string, unknown>).enqueueRaw).toBeUndefined();
    });
  });

  it("rejects an unknown job name instead of sending it", async () => {
    await withTestQueue(async (queue) => {
      await expect(queue.enqueue("test.not-registered", {})).rejects.toThrowError(
        /Unknown job "test\.not-registered"/
      );
    });
  });

  it("re-registering an existing queue reconciles its retry configuration (R2-F6)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("reconcile");
      const def1 = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 1, retryDelay: 0 },
        handler: () => undefined,
      });

      await queue.register(def1);
      let q = await queue.getQueue(name);
      expect(q?.retryLimit).toBe(1);

      // Simulate a deployment changing the job's retry settings
      clearJobRegistry();
      const def2 = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 4, retryDelay: 5, retryBackoff: true },
        handler: () => undefined,
      });

      await queue.register(def2);
      q = await queue.getQueue(name);
      expect(q?.retryLimit).toBe(4);
      expect(q?.retryDelay).toBe(5);
      expect(q?.retryBackoff).toBe(true);
    });
  });

  it("Queue adapter accepts an injected PgBoss client constructed in app/shared/container/ (R2-F5)", async () => {
    const schema = uniqueSchema();
    const boss = createPgBoss({
      connectionString: requireTestDatabaseUrl(),
      schema,
      onError: () => undefined,
    });
    const queue = new Queue(boss, { schema, pollingIntervalSeconds: 0.5 });
    await queue.start();

    try {
      const name = jobName("injected");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      });
      await queue.register(definition);
      const jobId = await queue.enqueue(name, { orderId: "ord-inj" });
      expect(jobId).toEqual(expect.any(String));
    } finally {
      await queue.destroy({ dropSchema: true });
    }
  });

  it("round-trips discriminatedUnion payloads through pg-boss and worker (R3-F3)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("discriminated-roundtrip");
      const received: unknown[] = [];
      const definition = defineJob({
        name,
        schema: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("order"), orderId: z.string() }),
          z.object({ kind: z.literal("account"), accountId: z.string() }),
        ]),
        handler: (payload) => {
          received.push(payload);
        },
      });

      await queue.work(definition);
      await queue.enqueue(name, { kind: "order", orderId: "ord-100" });
      await queue.enqueue(name, { kind: "account", accountId: "acc-200" });

      await waitFor(
        async () => (await queue.findJobs(name)).filter((j) => j.state === "completed"),
        (jobs) => jobs.length === 2
      );

      expect(received).toEqual([
        { kind: "order", orderId: "ord-100" },
        { kind: "account", accountId: "acc-200" },
      ]);
    });
  });

  it("fails a null payload on receive and moves it to <name>.dead (R3-F3)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("receive-null");
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
      await enqueueTestRaw(queue, name, null, { singletonKey: "raw-null-1" });

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.data).toBeNull();
      expect(deadLetter.sourceName).toBe(name);
    });
  });
});
