import { ALLOWED, SWEEP_EVERY } from "./decision.ts";
import type { RateLimitDecision } from "./decision.ts";

export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: () => TokenBucketConfig;
  private readonly now: () => number;
  private calls = 0;

  constructor(config: () => TokenBucketConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  tryAcquire(key: string, cost: number): RateLimitDecision {
    const now = this.now();
    const { capacity, refillPerSecond } = this.config();
    this.calls += 1;
    if (this.calls % SWEEP_EVERY === 0) {
      this.sweep(now, capacity, refillPerSecond);
    }
    if (!(cost > 0)) {
      return ALLOWED;
    }
    const perMs = refillPerSecond / 1000;
    if (cost > capacity || !(perMs > 0)) {
      return { allowed: false, retryAfterMs: perMs > 0 ? Math.ceil(cost / perMs) : Number.POSITIVE_INFINITY };
    }
    const bucket = this.refill(key, now, capacity, perMs);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return ALLOWED;
    }
    return { allowed: false, retryAfterMs: Math.max(1, Math.ceil((cost - bucket.tokens) / perMs)) };
  }

  reset(): void {
    this.buckets.clear();
  }

  private refill(key: string, now: number, capacity: number, perMs: number): Bucket {
    const bucket = this.buckets.get(key);
    if (bucket === undefined) {
      const created = { tokens: capacity, updatedAt: now };
      this.buckets.set(key, created);
      return created;
    }
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * perMs);
    bucket.updatedAt = now;
    return bucket;
  }

  // A full bucket behaves exactly like a missing one, so it can be dropped.
  private sweep(now: number, capacity: number, refillPerSecond: number): void {
    const perMs = refillPerSecond / 1000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + Math.max(0, now - bucket.updatedAt) * perMs >= capacity) {
        this.buckets.delete(key);
      }
    }
  }
}
