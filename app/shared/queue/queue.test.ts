import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPgBoss } from "../container/queue.server";
import { JobDefinitionError, JobPayloadValidationError, clearJobRegistry, defineJob } from "./define-job";
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

  it("handler throws twice, retryLimit 3: runs 3 times, succeeds (Examples, R5-F2)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("retry-exact-3");
      let attempts = 0;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 3, retryDelay: 0 },
        handler: async () => {
          attempts += 1;
          if (attempts <= 2) throw new Error("transient failure");
        },
      });

      await queue.work(definition);
      await queue.enqueue(name, { orderId: "order-retry-exact" }, { singletonKey: "order-retry-exact" });

      const completed = await waitFor(
        async () => (await queue.findJobs(name))[0],
        (job) => job.state === "completed"
      );

      expect(attempts).toBe(3);
      expect(completed.state).toBe("completed");
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

      let enqueueError: unknown;
      try {
        await queue.enqueue(name, { orderId: "order-4", rxText: "SPH -2.25" });
      } catch (err) {
        enqueueError = err;
      }
      expect(enqueueError).toBeInstanceOf(JobPayloadValidationError);
      const err = enqueueError as JobPayloadValidationError;
      expect(err.issues).toEqual([{ path: [], code: "unrecognized_keys" }]);
      expect(err.message).toContain("unrecognized_keys");
      expect(err.message).not.toContain("rxText");
      expect(err.message).not.toContain("SPH -2.25");
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

  it("sanitizes validation errors on enqueue and receive so plaintext Rx values never leak (R5-F1)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("rx-sanitized");
      let handlerCalled = false;
      const definition = defineJob({
        name,
        schema: z.object({
          mode: z.enum(["SINGLE_VISION", "PROGRESSIVE"]),
        }),
        retry: { retryLimit: 0, retryDelay: 0 },
        handler: () => {
          handlerCalled = true;
        },
      });
      await queue.register(definition);

      // 1. Enqueue validation failure path:
      // Must throw a sanitized error with only job name, issue paths, and Zod issue codes;
      // never the received value, Zod's message text, or the ZodError as cause.
      let enqueueError: unknown;
      try {
        await queue.enqueue(name, { mode: "SPH -2.25" });
      } catch (err) {
        enqueueError = err;
      }

      expect(enqueueError).toBeInstanceOf(JobPayloadValidationError);
      const enqErr = enqueueError as JobPayloadValidationError;
      expect(enqErr.jobName).toBe(name);
      expect(enqErr.issues).toEqual([{ path: ["mode"], code: "invalid_enum_value" }]);
      expect(enqErr.message).toContain(name);
      expect(enqErr.message).toContain("mode");
      expect(enqErr.message).toContain("invalid_enum_value");
      expect(enqErr.message).not.toContain("SPH -2.25");
      expect(enqErr.message).not.toContain("Expected");
      expect(enqErr.cause).toBeUndefined();
      expect(enqErr.stack).not.toContain("SPH -2.25");
      expect(JSON.stringify(enqErr)).not.toContain("SPH -2.25");
      expect(await queue.findJobs(name)).toHaveLength(0);

      // 2. Receive validation failure path:
      // Insert raw invalid payload directly into pg-boss; worker validates on receive.
      // The job fails and moves to <name>.dead, and the failure stored by pg-boss
      // in pgboss.job output must never contain the plaintext Rx value.
      await queue.work(definition);
      await enqueueTestRaw(
        queue,
        name,
        { mode: "SPH -2.25" },
        { singletonKey: "raw-rx-mode" }
      );

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.sourceName).toBe(name);

      // Retrieve the failed job record from pg-boss to inspect its stored failure output
      const jobs = await queue.findJobs(name);
      const failedJob = jobs.find((j) => j.state === "failed");
      expect(failedJob).toBeDefined();
      expect(failedJob?.output).toBeDefined();

      const failureJson = JSON.stringify(failedJob?.output);
      expect(failureJson).not.toContain("SPH -2.25");
      expect(failureJson).not.toContain("Expected");
      expect(failureJson).toContain(name);
      expect(failureJson).toContain("mode");
      expect(failureJson).toContain("invalid_enum_value");
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

  it("rejects a payload with an extra key 'SPH -2.25' on enqueue and receive without leaking the key or value (R6-F2)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("extra-key-inv2");
      let handlerCalled = false;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 0, retryDelay: 0 },
        handler: () => {
          handlerCalled = true;
        },
      });
      await queue.register(definition);

      // 1. Enqueue path:
      // An extra key 'SPH -2.25' must be rejected with JobPayloadValidationError,
      // and neither the key name nor the value may appear in the error or its serialization.
      let enqueueError: unknown;
      try {
        await queue.enqueue(name, {
          orderId: "ord-123",
          "SPH -2.25": "secret-rx-value",
        });
      } catch (error) {
        enqueueError = error;
      }

      expect(enqueueError).toBeInstanceOf(JobPayloadValidationError);
      const enqErr = enqueueError as JobPayloadValidationError;
      expect(enqErr.jobName).toBe(name);
      expect(enqErr.issues).toEqual([{ path: [], code: "unrecognized_keys" }]);
      expect(enqErr.message).toContain(name);
      expect(enqErr.message).toContain("unrecognized_keys");
      expect(enqErr.message).not.toContain("SPH -2.25");
      expect(enqErr.message).not.toContain("secret-rx-value");
      expect(enqErr.cause).toBeUndefined();
      expect(enqErr.stack).not.toContain("SPH -2.25");
      expect(enqErr.stack).not.toContain("secret-rx-value");
      expect(JSON.stringify(enqErr)).not.toContain("SPH -2.25");
      expect(JSON.stringify(enqErr)).not.toContain("secret-rx-value");
      expect(await queue.findJobs(name)).toHaveLength(0);

      // 2. Receive path:
      // Insert raw job with extra key 'SPH -2.25' directly into pg-boss; worker validates on receive.
      // The job fails and moves to <name>.dead, and the failure stored by pg-boss in pgboss.job output
      // must never contain the key name or its value.
      await queue.work(definition);
      await enqueueTestRaw(
        queue,
        name,
        { orderId: "ord-raw-1", "SPH -2.25": "secret-rx-value" },
        { singletonKey: "raw-extra-key-1" }
      );

      const deadLetter = await waitFor(
        async () => (await queue.findJobs(`${name}.dead`))[0],
        () => true
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetter.sourceName).toBe(name);

      const jobs = await queue.findJobs(name);
      const failedJob = jobs.find((j) => j.state === "failed");
      expect(failedJob).toBeDefined();
      expect(failedJob?.output).toBeDefined();

      const failureJson = JSON.stringify(failedJob?.output);
      expect(failureJson).not.toContain("SPH -2.25");
      expect(failureJson).not.toContain("secret-rx-value");
      expect(failureJson).toContain(name);
      expect(failureJson).toContain("unrecognized_keys");
    });
  });

  it("rejects registration and worker startup over a pre-existing standard queue for a singleton job (R6-F3)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("pre-existing-standard");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      });

      // Pre-create the queue directly in pg-boss with standard policy
      const boss = (queue as unknown as { boss: PgBoss }).boss;
      await boss.createQueue(name, { policy: "standard" });

      // Registration over the mismatched queue must reject with a clear, data-free error naming the queue and both policies
      await expect(queue.register(definition)).rejects.toThrowError(
        new RegExp(`Queue "${name}" has policy "standard" but expected "exclusive"`)
      );

      // queue.work (worker startup) must also reject with the same error
      await expect(queue.work(definition)).rejects.toThrowError(
        new RegExp(`Queue "${name}" has policy "standard" but expected "exclusive"`)
      );
    });
  });

  it("rejects payloads with inherited keys constructor, toString, and __proto__ carrying 'SPH -2.25' on enqueue and receive (R7-F1)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("inherited-keys-inv2");
      let handlerCalled = false;
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        retry: { retryLimit: 0, retryDelay: 0 },
        handler: () => {
          handlerCalled = true;
        },
      });
      await queue.register(definition);

      const inheritedKeys = ["constructor", "toString", "__proto__"] as const;

      // 1. Enqueue path:
      for (const key of inheritedKeys) {
        let enqueueError: unknown;
        try {
          await queue.enqueue(
            name,
            JSON.parse(`{"orderId": "ord-${key}", "${key}": "SPH -2.25"}`),
            { singletonKey: `enq-${key}` }
          );
        } catch (error) {
          enqueueError = error;
        }

        expect(enqueueError, `Expected enqueue with ${key} to fail`).toBeInstanceOf(
          JobPayloadValidationError
        );
        const enqErr = enqueueError as JobPayloadValidationError;
        expect(enqErr.jobName).toBe(name);
        expect(enqErr.issues).toEqual([{ path: [], code: "unrecognized_keys" }]);
        expect(enqErr.message).toContain(name);
        expect(enqErr.message).toContain("unrecognized_keys");
        expect(enqErr.message).not.toContain("SPH -2.25");
        expect(enqErr.cause).toBeUndefined();
        expect(enqErr.stack).not.toContain("SPH -2.25");
        expect(JSON.stringify(enqErr)).not.toContain("SPH -2.25");
      }
      expect(await queue.findJobs(name)).toHaveLength(0);

      // 2. Receive path:
      await queue.work(definition);
      for (const key of inheritedKeys) {
        await enqueueTestRaw(
          queue,
          name,
          JSON.parse(`{"orderId": "ord-raw-${key}", "${key}": "SPH -2.25"}`),
          { singletonKey: `raw-${key}` }
        );
      }

      const deadLetters = await waitFor(
        async () => {
          const dl = await queue.findJobs(`${name}.dead`);
          return dl.length === inheritedKeys.length ? dl : undefined;
        },
        (dl) => dl.length === inheritedKeys.length
      );

      expect(handlerCalled).toBe(false);
      expect(deadLetters).toHaveLength(inheritedKeys.length);
      for (const deadLetter of deadLetters) {
        expect(deadLetter.sourceName).toBe(name);
      }

      const jobs = await queue.findJobs(name);
      const failedJobs = jobs.filter((j) => j.state === "failed");
      expect(failedJobs).toHaveLength(inheritedKeys.length);
      for (const failedJob of failedJobs) {
        const failureJson = JSON.stringify(failedJob.output);
        expect(failureJson).not.toContain("SPH -2.25");
        expect(failureJson).toContain(name);
        expect(failureJson).toContain("unrecognized_keys");
      }
    });
  });

  it("rejects non-finite number values (Infinity, NaN) on enqueue (R7-F2)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("non-finite-enqueue");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.number() }),
        handler: () => undefined,
      });
      await queue.register(definition);

      // 1. Infinity fails on enqueue
      let infinityError: unknown;
      try {
        await queue.enqueue(name, { orderId: Infinity }, { singletonKey: "inf-1" });
      } catch (error) {
        infinityError = error;
      }
      expect(infinityError).toBeInstanceOf(JobPayloadValidationError);
      const infErr = infinityError as JobPayloadValidationError;
      expect(infErr.jobName).toBe(name);
      expect(infErr.issues).toEqual([{ path: ["orderId"], code: "not_finite" }]);
      expect(infErr.message).toContain("orderId: not_finite");
      expect(infErr.cause).toBeUndefined();

      // 2. NaN fails on enqueue
      let nanError: unknown;
      try {
        await queue.enqueue(name, { orderId: NaN }, { singletonKey: "nan-1" });
      } catch (error) {
        nanError = error;
      }
      expect(nanError).toBeInstanceOf(JobPayloadValidationError);
      const nErr = nanError as JobPayloadValidationError;
      expect(nErr.jobName).toBe(name);
      expect(nErr.issues).toEqual([{ path: ["orderId"], code: "invalid_type" }]);
      expect(nErr.message).toContain("orderId: invalid_type");
      expect(nErr.cause).toBeUndefined();

      // 3. -Infinity fails on enqueue
      await expect(
        queue.enqueue(name, { orderId: -Infinity }, { singletonKey: "neg-inf-1" })
      ).rejects.toBeInstanceOf(JobPayloadValidationError);

      // No invalid jobs were enqueued
      expect(await queue.findJobs(name)).toHaveLength(0);

      // 4. Valid finite number succeeds on enqueue
      const jobId = await queue.enqueue(name, { orderId: 42 }, { singletonKey: "valid-1" });
      expect(jobId).toEqual(expect.any(String));
      expect(await queue.findJobs(name)).toHaveLength(1);
    });
  });

  it("rejects fractional and negative retryDelay and retryLimit on enqueue (R8-F1)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("fractional-retry-enq");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      });
      await queue.register(definition);

      // Fractional retryDelay (0.5) is rejected
      await expect(
        queue.enqueue(name, { orderId: "ord-1" }, { retryDelay: 0.5, singletonKey: "retry-delay-1" })
      ).rejects.toThrowError(JobDefinitionError);

      // Negative retryDelay (-1) is rejected
      await expect(
        queue.enqueue(name, { orderId: "ord-2" }, { retryDelay: -1, singletonKey: "retry-delay-2" })
      ).rejects.toThrowError(JobDefinitionError);

      // Fractional retryLimit (0.5) is rejected
      await expect(
        queue.enqueue(name, { orderId: "ord-3" }, { retryLimit: 0.5, singletonKey: "retry-limit-1" })
      ).rejects.toThrowError(JobDefinitionError);

      // Negative retryLimit (-1) is rejected
      await expect(
        queue.enqueue(name, { orderId: "ord-4" }, { retryLimit: -1, singletonKey: "retry-limit-2" })
      ).rejects.toThrowError(JobDefinitionError);

      // Valid non-negative integer overrides succeed
      const jobId = await queue.enqueue(
        name,
        { orderId: "ord-valid" },
        { retryLimit: 3, retryDelay: 5, singletonKey: "retry-valid-1" }
      );
      expect(jobId).toEqual(expect.any(String));
    });
  });

  it("Queue.work throws without a handler (R2-F3)", async () => {
    await withTestQueue(async (queue) => {
      const name = jobName("work-no-handler");
      const definition = defineJob({
        name,
        schema: z.object({ orderId: z.string() }),
      });
      await expect(queue.work(definition)).rejects.toThrowError(
        `Cannot work job "${name}" without a handler`
      );
    });
  });
});
