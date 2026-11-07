import { HttpError } from "../errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, Bucket>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxKeys = 10_000,
    readonly clock: () => number = Date.now
  ) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1 ||
      !Number.isSafeInteger(maxKeys) ||
      maxKeys < 1
    ) {
      throw new RangeError("Rate limiter bounds must be positive safe integers.");
    }
  }

  consume(key: string): void {
    const now = this.clock();
    const current = this.#buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.#prune(now);
      if (!this.#buckets.has(key) && this.#buckets.size >= this.maxKeys) {
        throw new HttpError(429, "RATE_LIMITED", "Too many requests.");
      }
      this.#buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    if (current.count >= this.limit) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests.");
    }
    current.count += 1;
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
      }
    }
  }
}
