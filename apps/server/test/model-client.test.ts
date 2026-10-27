import { describe, expect, it } from "vitest";
import {
  BACKOFF_BASE_MS,
  MODEL_API_BASE_URL,
  ExponentialBackoffRetryPolicy,
  ModelError,
  computeBackoffMs,
  createModelClient,
  parseRetryAfterMs,
} from "../src/lib/model-client.ts";

describe("model client", () => {
  it("targets the Meta Model API", () => {
    expect(MODEL_API_BASE_URL).toBe("https://api.meta.ai/v1");
  });

  it("computes exponential backoff with jitter", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const floor = BACKOFF_BASE_MS * 2 ** attempt;
      for (let i = 0; i < 25; i += 1) {
        const value = computeBackoffMs(attempt);
        expect(value).toBeGreaterThanOrEqual(floor);
        expect(value).toBeLessThan(floor + BACKOFF_BASE_MS);
      }
    }
  });

  it("reads MODEL_API_KEY from the environment only", () => {
    const saved = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;
    try {
      expect(() => createModelClient()).toThrow("MODEL_API_KEY is not configured");
    } finally {
      if (saved !== undefined) {
        process.env.MODEL_API_KEY = saved;
      }
    }
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds and rejects anything else", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("soon")).toBeNull();
    expect(parseRetryAfterMs("-1")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });
});

describe("ExponentialBackoffRetryPolicy", () => {
  function testPolicy(maxRetries: number, sleeps: number[]) {
    return new ExponentialBackoffRetryPolicy(
      () => ({ maxRetries, baseMs: BACKOFF_BASE_MS }),
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      () => 0,
    );
  }

  it("retries while shouldRetry allows it", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await testPolicy(3, sleeps).run(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("boom");
      }
      return "ok";
    }, { shouldRetry: () => true });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
  });

  it("stops when shouldRetry refuses", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      testPolicy(3, sleeps).run(async () => {
        calls += 1;
        throw new Error("fatal");
      }, { shouldRetry: () => false }),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry without shouldRetry", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      testPolicy(3, sleeps).run(async () => {
        calls += 1;
        throw new Error("fatal");
      }),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("waits at least Retry-After before retrying", async () => {
    const sleeps: number[] = [];
    const failure = new ModelError("rate_limited", { model: "m", retryAfterMs: 5000 });
    await expect(
      testPolicy(1, sleeps).run(async () => {
        throw failure;
      }, { shouldRetry: () => true }),
    ).rejects.toBe(failure);
    expect(sleeps).toEqual([5000]);
  });

  it("does not call fn when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      testPolicy(3, []).run(
        async () => {
          calls += 1;
          return "unreached";
        },
        { signal: controller.signal, shouldRetry: () => true },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
