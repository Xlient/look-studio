import { describe, expect, it } from "vitest";
import { LruCache } from "../src/index.ts";

describe("LruCache", () => {
  it("evicts the least recently used entry, counting reads as use", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("overwrites in place, deletes, clears, and keeps falsy values", () => {
    const cache = new LruCache<string, number | null>(2);
    cache.set("a", 1);
    cache.set("a", 0);
    cache.set("b", null);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(0);
    expect(cache.get("b")).toBeNull();
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("rejects a capacity that is not a positive integer", () => {
    expect(() => new LruCache(0)).toThrow(RangeError);
    expect(() => new LruCache(1.5)).toThrow(RangeError);
  });
});
