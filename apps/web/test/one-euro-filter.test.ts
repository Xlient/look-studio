import { describe, expect, it } from "vitest";
import { LANDMARK_FILTER, createOneEuroFilter } from "../src/tracking/one-euro-filter.ts";

const FRAME_MS = 1000 / 30;

function seededNoise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  };
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

describe("createOneEuroFilter", () => {
  it("passes the first sample through and holds a steady value", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    expect(Array.from(filter.filter(Float32Array.of(0.25), 0))).toEqual([0.25]);
    expect(filter.filter(Float32Array.of(0.25), FRAME_MS)[0]).toBeCloseTo(0.25);
  });

  it("removes most of the jitter from a still face", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    const noise = seededNoise(7);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      const value = 0.5 + noise() * 0.004;
      const filtered = filter.filter(Float32Array.of(value), i * FRAME_MS)[0] ?? 0;
      if (i >= 30) {
        raw.push(value);
        out.push(filtered);
      }
    }
    expect(spread(out)).toBeLessThan(spread(raw) * 0.4);
  });

  it("keeps up with fast movement", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    let value = 0;
    let filtered = 0;
    for (let i = 0; i < 15; i += 1) {
      value = i * (0.5 / 30);
      filtered = filter.filter(Float32Array.of(value), i * FRAME_MS)[0] ?? 0;
    }
    expect(value - filtered).toBeLessThan(0.02);
  });

  it("settles on a new position after a quick move, such as lips opening", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    filter.filter(Float32Array.of(0.5), 0);
    let filtered = 0;
    for (let i = 1; i <= 15; i += 1) {
      filtered = filter.filter(Float32Array.of(0.53), i * FRAME_MS)[0] ?? 0;
    }
    expect(filtered).toBeCloseTo(0.53, 2);
  });

  it("restarts after a gap instead of sliding across the frame", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    filter.filter(Float32Array.of(0.1), 0);
    expect(filter.filter(Float32Array.of(0.9), LANDMARK_FILTER.resetAfterMs + 1)[0]).toBeCloseTo(0.9);
  });

  it("ignores repeated timestamps and bad samples, and reuses its output", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    const first = filter.filter(Float32Array.of(0.5, 0.5), 0);
    expect(filter.filter(Float32Array.of(0.9, 0.9), 0)).toBe(first);
    expect(first[0]).toBeCloseTo(0.5);
    filter.filter(Float32Array.of(Number.NaN, 0.5), FRAME_MS);
    expect(first[0]).toBeCloseTo(0.5);
  });

  it("restarts when the sample size changes", () => {
    const filter = createOneEuroFilter(LANDMARK_FILTER);
    filter.filter(Float32Array.of(0.1), 0);
    expect(Array.from(filter.filter(Float32Array.of(0.5, 0.5), FRAME_MS))).toEqual([0.5, 0.5]);
  });
});
