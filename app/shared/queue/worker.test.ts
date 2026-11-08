import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Queue } from "./queue";
import { dropTestSchema, requireTestDatabaseUrl, testSchemaExists, uniqueSchema } from "./test-support";
import { runWorker } from "./worker";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mockedAccess = vi.fn((...args: Parameters<typeof actual.access>) => actual.access(...args));
  return {
    ...actual,
    default: { ...actual, access: mockedAccess },
    access: mockedAccess,
  };
});

const FIXTURES_DIR = resolve(process.cwd(), "app/shared/queue/__fixtures__/features");

describe("worker startup error handling (R4-F2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops pg-boss with graceful timeout when queue registration fails during startup", async () => {
    const stopSpy = vi.spyOn(PgBoss.prototype, "stop");
    vi.spyOn(Queue.prototype, "registerAll").mockRejectedValueOnce(
      new Error("simulated queue registration failure")
    );

    const schema = uniqueSchema();
    const databaseUrl = requireTestDatabaseUrl();

    try {
      await expect(
        runWorker([
          "--schema",
          schema,
          "--database-url",
          databaseUrl,
          "--features-dir",
          FIXTURES_DIR,
        ])
      ).rejects.toThrow("simulated queue registration failure");

      expect(stopSpy).toHaveBeenCalledWith(
        expect.objectContaining({ graceful: true, timeout: 10_000 })
      );
    } finally {
      await dropTestSchema(schema);
    }

    expect(await testSchemaExists(schema)).toBe(false);
  });

  it("stops pg-boss with graceful timeout when handler registration fails during startup", async () => {
    const stopSpy = vi.spyOn(PgBoss.prototype, "stop");
    vi.spyOn(Queue.prototype, "work").mockRejectedValueOnce(
      new Error("simulated handler registration failure")
    );

    const schema = uniqueSchema();
    const databaseUrl = requireTestDatabaseUrl();

    try {
      await expect(
        runWorker([
          "--schema",
          schema,
          "--database-url",
          databaseUrl,
          "--features-dir",
          FIXTURES_DIR,
        ])
      ).rejects.toThrow("simulated handler registration failure");

      expect(stopSpy).toHaveBeenCalledWith(
        expect.objectContaining({ graceful: true, timeout: 10_000 })
      );
    } finally {
      await dropTestSchema(schema);
    }

    expect(await testSchemaExists(schema)).toBe(false);
  });

  it("fails worker startup when job discovery throws a filesystem error other than ENOENT (R5-F4)", async () => {
    const eaccesError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    vi.mocked(fsPromises.access).mockRejectedValueOnce(eaccesError);

    const schema = uniqueSchema();
    const databaseUrl = requireTestDatabaseUrl();

    try {
      await expect(
        runWorker([
          "--schema",
          schema,
          "--database-url",
          databaseUrl,
          "--features-dir",
          FIXTURES_DIR,
        ])
      ).rejects.toThrow("EACCES: permission denied");
    } finally {
      await dropTestSchema(schema);
    }
  });

  it("skips handler-less job definitions without calling queue.work (R2-F3)", async () => {
    const workSpy = vi.spyOn(Queue.prototype, "work");
    const { defineJob } = await import("./define-job");
    const { z } = await import("zod");
    const handlerLessJob = defineJob({
      name: "test.worker-skip-no-handler",
      schema: z.object({ orderId: z.string() }),
    });

    const discovery = await import("./discovery.server");
    vi.spyOn(discovery, "discoverJobs").mockResolvedValueOnce([handlerLessJob]);

    const schema = uniqueSchema();
    const databaseUrl = requireTestDatabaseUrl();

    let workerHandle: Awaited<ReturnType<typeof runWorker>> | undefined;
    try {
      workerHandle = await runWorker([
        "--schema",
        schema,
        "--database-url",
        databaseUrl,
        "--features-dir",
        FIXTURES_DIR,
      ]);

      expect(workSpy).not.toHaveBeenCalledWith(handlerLessJob);
    } finally {
      if (workerHandle) {
        await workerHandle.stop();
      }
      await dropTestSchema(schema);
    }
  });
});
