import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Queue } from "./queue";
import { requireTestDatabaseUrl, uniqueSchema } from "./test-support";
import { runWorker } from "./worker";

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
  });

  it("stops pg-boss with graceful timeout when handler registration fails during startup", async () => {
    const stopSpy = vi.spyOn(PgBoss.prototype, "stop");
    vi.spyOn(Queue.prototype, "work").mockRejectedValueOnce(
      new Error("simulated handler registration failure")
    );

    const schema = uniqueSchema();
    const databaseUrl = requireTestDatabaseUrl();

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
  });
});
