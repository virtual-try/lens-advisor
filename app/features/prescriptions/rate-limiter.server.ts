import { RateLimitedError } from "../../shared/http/errors.server";

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class MemoryRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private lastMonotonicTime: number = 0;
  private hits: Map<string, number[]> = new Map();

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxRequests = options.maxRequests ?? 20;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * Sweeps and evicts completely expired entries from the map (R1-F11).
   */
  private sweepExpired(currentTime: number): void {
    const windowStart = currentTime - this.windowMs;
    for (const [key, timestamps] of this.hits.entries()) {
      const lastHit = timestamps[timestamps.length - 1];
      if (!lastHit || lastHit <= windowStart) {
        this.hits.delete(key);
      }
    }
  }

  check(key: string): RateLimitResult {
    const rawTime = this.now();
    // Clamp to monotonic time: never allow time to step backwards (R1-F10)
    const currentTime = Math.max(rawTime, this.lastMonotonicTime);
    this.lastMonotonicTime = currentTime;

    // Evict expired entries during sweep (R1-F11)
    this.sweepExpired(currentTime);

    const windowStart = currentTime - this.windowMs;

    let timestamps = this.hits.get(key) ?? [];
    // Prune entries older than the rolling window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, oldest + this.windowMs - currentTime);
      // Re-insert to refresh LRU access order
      this.hits.delete(key);
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    timestamps.push(currentTime);
    // Re-insert to refresh LRU access order
    this.hits.delete(key);
    this.hits.set(key, timestamps);

    // Evict oldest entries if map exceeds bounded maxKeys (LRU eviction)
    while (this.hits.size > this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey !== undefined) {
        this.hits.delete(oldestKey);
      } else {
        break;
      }
    }

    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetMs: this.windowMs,
    };
  }

  assertAllowed(key: string): void {
    const result = this.check(key);
    if (!result.allowed) {
      throw new RateLimitedError("Too many requests", "RATE_LIMITED");
    }
  }

  reset(): void {
    this.hits.clear();
    this.lastMonotonicTime = 0;
  }

  size(): number {
    return this.hits.size;
  }

  has(key: string): boolean {
    return this.hits.has(key);
  }
}

/**
 * Shared in-memory rate limiter for prescription proxy endpoints (20 req / min / shop+IP).
 */
export const prescriptionRateLimiter = new MemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
});
