import { RateLimitedError } from "../../shared/http/errors.server";

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
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
  private readonly now: () => number;
  private hits: Map<string, number[]> = new Map();

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxRequests = options.maxRequests ?? 20;
    this.now = options.now ?? (() => Date.now());
  }

  check(key: string): RateLimitResult {
    const currentTime = this.now();
    const windowStart = currentTime - this.windowMs;

    let timestamps = this.hits.get(key) ?? [];
    // Prune entries older than the rolling window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, oldest + this.windowMs - currentTime);
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    timestamps.push(currentTime);
    this.hits.set(key, timestamps);

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
  }
}

/**
 * Shared in-memory rate limiter for prescription proxy endpoints (20 req / min / shop+IP).
 */
export const prescriptionRateLimiter = new MemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
});
