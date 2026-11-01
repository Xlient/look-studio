import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter, TokenBucketRateLimiter } from "../src/index.ts";

describe("SlidingWindowRateLimiter", () => {
  it("frees capacity as each request ages out, not all at once", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(() => ({ max: 2, windowMs: 1_000 }), () => now);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    now = 400;
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    now = 500;
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: false, retryAfterMs: 500 });
    now = 1_000;
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: false, retryAfterMs: 400 });
  });

  it("does not count refused requests and reports the wait for a larger cost", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(() => ({ max: 3, windowMs: 1_000 }), () => now);
    limiter.tryAcquire("k", 1);
    now = 100;
    limiter.tryAcquire("k", 1);
    now = 200;
    expect(limiter.tryAcquire("k", 3)).toEqual({ allowed: false, retryAfterMs: 900 });
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 5)).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect(limiter.tryAcquire("other", 3).allowed).toBe(true);
  });

  it("allows zero or invalid cost without recording it, and resets", () => {
    const limiter = new SlidingWindowRateLimiter(() => ({ max: 1, windowMs: 1_000 }), () => 0);
    expect(limiter.tryAcquire("k", 0).allowed).toBe(true);
    expect(limiter.tryAcquire("k", Number.NaN).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(false);
    limiter.reset();
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
  });

  it("stays correct across many requests and idle keys", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(() => ({ max: 10, windowMs: 100 }), () => now);
    let allowed = 0;
    for (let i = 0; i < 5_000; i += 1) {
      now = i;
      allowed += limiter.tryAcquire(i % 7 === 0 ? `idle-${i}` : "busy", 1).allowed ? 1 : 0;
    }
    expect(allowed).toBeGreaterThan(400);
    now = 10_000;
    expect(limiter.tryAcquire("busy", 10).allowed).toBe(true);
  });
});

describe("TokenBucketRateLimiter", () => {
  it("allows a burst up to capacity, then refills at the set rate", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter(() => ({ capacity: 3, refillPerSecond: 2 }), () => now);
    expect([1, 2, 3].map(() => limiter.tryAcquire("k", 1).allowed)).toEqual([true, true, true]);
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: false, retryAfterMs: 500 });
    now = 500;
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    now = 60_000;
    expect([1, 2, 3, 4].map(() => limiter.tryAcquire("k", 1).allowed)).toEqual([true, true, true, false]);
  });

  it("refuses a cost above capacity or with no refill, and isolates keys", () => {
    const limiter = new TokenBucketRateLimiter(() => ({ capacity: 2, refillPerSecond: 1 }), () => 0);
    expect(limiter.tryAcquire("k", 3)).toEqual({ allowed: false, retryAfterMs: 3_000 });
    expect(limiter.tryAcquire("k", 2).allowed).toBe(true);
    expect(limiter.tryAcquire("other", 2).allowed).toBe(true);
    const stuck = new TokenBucketRateLimiter(() => ({ capacity: 2, refillPerSecond: 0 }), () => 0);
    expect(stuck.tryAcquire("k", 1).retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores a clock that goes backwards", () => {
    let now = 1_000;
    const limiter = new TokenBucketRateLimiter(() => ({ capacity: 1, refillPerSecond: 1 }), () => now);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    now = 0;
    expect(limiter.tryAcquire("k", 1).allowed).toBe(false);
  });
});
