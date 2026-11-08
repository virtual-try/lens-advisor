// @vitest-environment node
import { describe, expect, it } from "vitest";

import { RateLimitedError } from "../../shared/http/errors.server";
import { MemoryRateLimiter } from "./rate-limiter.server";

describe("MemoryRateLimiter", () => {
  it("allows up to maxRequests and blocks subsequent requests within window", () => {
    const mockTime = 1_000;
    const limiter = new MemoryRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      now: () => mockTime,
    });

    expect(limiter.check("client1").allowed).toBe(true);
    expect(limiter.check("client1").allowed).toBe(true);
    expect(limiter.check("client1").allowed).toBe(true);

    const blocked = limiter.check("client1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);

    expect(() => limiter.assertAllowed("client1")).toThrowError(RateLimitedError);
  });

  it("R1-F10: backward clock adjustment does not extend existing rate-limit lockout", () => {
    let mockTime = 10_000;
    const limiter = new MemoryRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      now: () => mockTime,
    });

    // Request 1 and 2 at t = 10_000
    expect(limiter.check("client-rollback").allowed).toBe(true);
    expect(limiter.check("client-rollback").allowed).toBe(true);

    // Limit reached at t = 10_000
    const blockedBefore = limiter.check("client-rollback");
    expect(blockedBefore.allowed).toBe(false);
    expect(blockedBefore.resetMs).toBe(60_000);

    // Backward wall-clock step: clock rolls back from 10_000 to 5_000
    mockTime = 5_000;

    const blockedAfter = limiter.check("client-rollback");
    expect(blockedAfter.allowed).toBe(false);
    // Lockout MUST NOT be extended to 65_000 (which would happen without monotonic clamping)
    expect(blockedAfter.resetMs).toBeLessThanOrEqual(60_000);

    // Advance clock forward to 70_001 ms (monotonic 60_001 ms after first request at 10_000)
    mockTime = 70_001;
    const allowedAfterWindow = limiter.check("client-rollback");
    expect(allowedAfterWindow.allowed).toBe(true);
  });

  it("R1-F11: expired shop/IP entries are removed during sweep and map size is bounded", () => {
    let mockTime = 1_000;
    const limiter = new MemoryRateLimiter({
      windowMs: 60_000,
      maxRequests: 5,
      maxKeys: 3,
      now: () => mockTime,
    });

    // Populate key1 and key2 at t = 1_000
    limiter.check("shopA:1.1.1.1");
    limiter.check("shopA:2.2.2.2");
    expect(limiter.has("shopA:1.1.1.1")).toBe(true);
    expect(limiter.has("shopA:2.2.2.2")).toBe(true);
    expect(limiter.size()).toBe(2);

    // Advance time past the 60_000 ms window
    mockTime = 61_001;

    // A request from key3 triggers the sweep of expired entries
    limiter.check("shopA:3.3.3.3");

    // Expired keys are evicted
    expect(limiter.has("shopA:1.1.1.1")).toBe(false);
    expect(limiter.has("shopA:2.2.2.2")).toBe(false);
    expect(limiter.has("shopA:3.3.3.3")).toBe(true);
    expect(limiter.size()).toBe(1);

    // Test maxKeys LRU bounding:
    limiter.check("shopA:4.4.4.4");
    limiter.check("shopA:5.5.5.5");
    expect(limiter.size()).toBe(3);

    // Adding a 4th active key evicts the oldest (shopA:3.3.3.3)
    limiter.check("shopA:6.6.6.6");
    expect(limiter.size()).toBe(3);
    expect(limiter.has("shopA:3.3.3.3")).toBe(false);
    expect(limiter.has("shopA:4.4.4.4")).toBe(true);
    expect(limiter.has("shopA:5.5.5.5")).toBe(true);
    expect(limiter.has("shopA:6.6.6.6")).toBe(true);
  });
});
