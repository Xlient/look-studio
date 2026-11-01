import { describe, expect, it } from "vitest";
import { SlidingWindowBudget } from "../src/index.ts";

const MINUTE = 60_000;

describe("SlidingWindowBudget", () => {
  it("records spend and reports remaining and exceeded", () => {
    const budget = new SlidingWindowBudget(() => 5, () => 0);
    expect(budget.record(2)).toBe(2);
    expect(budget.remaining()).toBe(3);
    expect(budget.isExceeded()).toBe(false);
    budget.record(3);
    expect(budget.isExceeded()).toBe(true);
    expect(budget.remaining()).toBe(0);
  });

  it("lets spend age out over a rolling window instead of at midnight", () => {
    let now = 0;
    const budget = new SlidingWindowBudget(() => 5, () => now, { windowMs: 60 * MINUTE, bucketMs: 5 * MINUTE });
    budget.record(3);
    now = 30 * MINUTE;
    budget.record(2);
    expect(budget.isExceeded()).toBe(true);
    now = 60 * MINUTE;
    expect(budget.spent()).toBe(2);
    expect(budget.isExceeded()).toBe(false);
    now = 90 * MINUTE;
    expect(budget.spent()).toBe(0);
  });

  it("ignores negative, zero, and non-finite costs, follows a changing cap, and resets", () => {
    let cap = 1;
    const budget = new SlidingWindowBudget(() => cap, () => 0);
    budget.record(-5);
    budget.record(Number.NaN);
    budget.record(Number.POSITIVE_INFINITY);
    expect(budget.spent()).toBe(0);
    budget.record(1);
    expect(budget.isExceeded()).toBe(true);
    cap = 2;
    expect(budget.isExceeded()).toBe(false);
    budget.reset();
    expect(budget.spent()).toBe(0);
  });

  it("rejects a window without a positive bucket", () => {
    expect(() => new SlidingWindowBudget(() => 1, () => 0, { windowMs: 10, bucketMs: 0 })).toThrow(RangeError);
    expect(() => new SlidingWindowBudget(() => 1, () => 0, { windowMs: 1, bucketMs: 10 })).toThrow(RangeError);
  });
});
