import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { container, createContainer } from "../src/container.ts";
import { InMemoryRateLimiter, resetRateLimiter } from "../src/lib/rate-limit.ts";
import { InMemoryBudgetTracker, resetSpendLedger } from "../src/lib/spend-cap.ts";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  resetRateLimiter();
  resetSpendLedger();
});

describe("InMemoryRateLimiter", () => {
  it("denies past max with retryAfterMs until the window resets", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(() => ({ max: 2, windowMs: 60_000 }), () => now);
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: false, retryAfterMs: 60_000 });
    now += 60_000;
    expect(limiter.tryAcquire("k", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("accounts cost and isolates keys", () => {
    const limiter = new InMemoryRateLimiter(() => ({ max: 5, windowMs: 60_000 }), () => 0);
    expect(limiter.tryAcquire("a", 5).allowed).toBe(true);
    expect(limiter.tryAcquire("a", 1).allowed).toBe(false);
    expect(limiter.tryAcquire("b", 1).allowed).toBe(true);
  });

  it("reset clears every bucket", () => {
    const limiter = new InMemoryRateLimiter(() => ({ max: 1, windowMs: 60_000 }), () => 0);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 1).allowed).toBe(false);
    limiter.reset();
    expect(limiter.tryAcquire("k", 1).allowed).toBe(true);
  });
});

describe("InMemoryBudgetTracker", () => {
  it("records spend and reports remaining and exceeded", () => {
    const tracker = new InMemoryBudgetTracker(() => 5, () => "2026-01-01");
    expect(tracker.record(2)).toBe(2);
    expect(tracker.remaining()).toBe(3);
    expect(tracker.isExceeded()).toBe(false);
    tracker.record(3);
    expect(tracker.isExceeded()).toBe(true);
    expect(tracker.remaining()).toBe(0);
  });

  it("rolls over on a new day", () => {
    let day = "2026-01-01";
    const tracker = new InMemoryBudgetTracker(() => 5, () => day);
    tracker.record(5);
    expect(tracker.isExceeded()).toBe(true);
    day = "2026-01-02";
    expect(tracker.isExceeded()).toBe(false);
    expect(tracker.remaining()).toBe(5);
  });
});

describe("container", () => {
  it("provides working default implementations", () => {
    expect(container.rateLimiter.tryAcquire("probe", 1).allowed).toBe(true);
    expect(container.budgetTracker.isExceeded()).toBe(false);
  });

  it("accepts overrides and keeps other defaults", () => {
    const custom = new InMemoryRateLimiter(() => ({ max: 1, windowMs: 60_000 }), () => 0);
    const mixed = createContainer({ rateLimiter: custom });
    expect(mixed.rateLimiter.tryAcquire("k", 1).allowed).toBe(true);
    expect(mixed.rateLimiter.tryAcquire("k", 1).allowed).toBe(false);
    expect(mixed.budgetTracker).toBe(container.budgetTracker);
  });
});

describe("rate limit middleware", () => {
  it("sets a Retry-After header on 429", async () => {
    process.env.RATE_LIMIT_MAX = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    resetRateLimiter();
    const app = createApp();
    const headers = { "x-forwarded-for": "198.51.100.9" };
    expect((await app.request("/health", { headers })).status).toBe(200);
    const limited = await app.request("/health", { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
});
