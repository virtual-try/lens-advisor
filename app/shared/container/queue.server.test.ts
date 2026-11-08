import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgBoss } from "pg-boss";
import { resetConfigCache } from "../config.server";
import { Queue } from "../queue/queue";
import { requireTestDatabaseUrl } from "../queue/test-support";
import { getQueue, resetQueueForTest } from "./queue.server";

describe("getQueue initialization error handling (R4-F3)", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", requireTestDatabaseUrl());
    resetConfigCache();
    await resetQueueForTest();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await resetQueueForTest();
    resetConfigCache();
  });

  it("stops started pg-boss instance before clearing cached promise on init failure, enabling clean retry", async () => {
    const stopSpy = vi.spyOn(PgBoss.prototype, "stop");
    vi.spyOn(Queue.prototype, "registerAll").mockRejectedValueOnce(
      new Error("simulated registerAll failure")
    );

    // Initial attempt fails during registration
    await expect(getQueue()).rejects.toThrow("simulated registerAll failure");

    // The started pg-boss instance must have been stopped gracefully
    expect(stopSpy).toHaveBeenCalledWith(
      expect.objectContaining({ graceful: true, timeout: 10_000 })
    );

    // Subsequent retry must start clean with a new instance and succeed
    const queue = await getQueue();
    expect(queue).toBeDefined();
    expect(queue).toBeInstanceOf(Queue);
  });

  it("handles concurrent getQueue callers on init failure without leaking", async () => {
    const stopSpy = vi.spyOn(PgBoss.prototype, "stop");
    vi.spyOn(Queue.prototype, "registerAll").mockRejectedValueOnce(
      new Error("concurrent simulated failure")
    );

    const call1 = getQueue();
    const call2 = getQueue();

    await expect(call1).rejects.toThrow("concurrent simulated failure");
    await expect(call2).rejects.toThrow("concurrent simulated failure");

    expect(stopSpy).toHaveBeenCalledWith(
      expect.objectContaining({ graceful: true, timeout: 10_000 })
    );

    const queue = await getQueue();
    expect(queue).toBeDefined();
    expect(queue).toBeInstanceOf(Queue);
  });
});
