import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError, ExponentialBackoffRetryPolicy, computeBackoffMs, retryAfterFrom } from "../src/index.ts";

class Transient extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(retryAfterMs?: number) {
    super("transient");
    this.retryAfterMs = retryAfterMs;
  }
}

const isTransient = (error: unknown) => error instanceof Transient;

function policy(maxRetries = 3, extras = {}) {
  const waits: number[] = [];
  const retry = new ExponentialBackoffRetryPolicy(
    () => ({ maxRetries, baseMs: 100, maxDelayMs: 1_000 }),
    async (ms) => void waits.push(ms),
    () => 0.5,
    extras,
  );
  return { retry, waits };
}

function failing(times: number, error: () => Error = () => new Transient()) {
  let calls = 0;
  return {
    fn: async () => {
      calls += 1;
      if (calls <= times) {
        throw error();
      }
      return "ok";
    },
    calls: () => calls,
  };
}

describe("ExponentialBackoffRetryPolicy", () => {
  it("backs off exponentially with jitter, capped, and honours Retry-After", async () => {
    expect(computeBackoffMs(2, () => 0.5, 100)).toBe(450);
    const { retry, waits } = policy(4);
    const run = failing(4, () => new Transient(waits.length === 1 ? 3_000 : undefined));
    await expect(retry.run(run.fn, { shouldRetry: isTransient })).resolves.toBe("ok");
    expect(waits).toEqual([150, 3_000, 450, 850]);
    expect(policy(4).waits).toEqual([]);
    const capped = policy(6);
    await capped.retry.run(failing(5).fn, { shouldRetry: isTransient });
    expect(capped.waits.at(-1)).toBe(1_000);
  });

  it("stops at the retry limit and on errors the predicate rejects", async () => {
    const { retry } = policy(2);
    const exhausted = failing(5);
    await expect(retry.run(exhausted.fn, { shouldRetry: isTransient })).rejects.toBeInstanceOf(Transient);
    expect(exhausted.calls()).toBe(3);
    const fatal = failing(5, () => new Error("bad request"));
    await expect(retry.run(fatal.fn, { shouldRetry: isTransient })).rejects.toThrow("bad request");
    expect(fatal.calls()).toBe(1);
    const noPredicate = failing(1);
    await expect(retry.run(noPredicate.fn)).rejects.toBeInstanceOf(Transient);
  });

  it("does not start or retry once aborted", async () => {
    const { retry } = policy(5);
    const controller = new AbortController();
    controller.abort();
    const run = failing(0);
    await expect(retry.run(run.fn, { signal: controller.signal })).rejects.toThrow();
    expect(run.calls()).toBe(0);
    const later = new AbortController();
    let calls = 0;
    const abortingFn = async () => {
      calls += 1;
      later.abort();
      throw new Transient();
    };
    await expect(retry.run(abortingFn, { signal: later.signal, shouldRetry: isTransient })).rejects.toBeInstanceOf(Transient);
    expect(calls).toBe(1);
  });

  it("reads retryAfterMs only when it is a usable number", () => {
    expect(retryAfterFrom({ retryAfterMs: 20 })).toBe(20);
    expect(retryAfterFrom({ retryAfterMs: -1 })).toBeNull();
    expect(retryAfterFrom({ retryAfterMs: "20" })).toBeNull();
    expect(retryAfterFrom(null)).toBeNull();
  });
});

describe("CircuitBreaker", () => {
  it("opens after repeated transient failures, fails fast, then lets one probe through", async () => {
    let now = 0;
    const breaker = new CircuitBreaker(() => ({ failureThreshold: 2, cooldownMs: 1_000 }), () => now);
    const { retry } = policy(0, { breaker, onOpen: (error: CircuitOpenError) => new Error(`open ${error.retryAfterMs}`) });
    await expect(retry.run(failing(1).fn, { shouldRetry: isTransient })).rejects.toBeInstanceOf(Transient);
    await expect(retry.run(failing(1).fn, { shouldRetry: isTransient })).rejects.toBeInstanceOf(Transient);
    expect(breaker.state()).toBe("open");
    now = 400;
    const skipped = failing(0);
    await expect(retry.run(skipped.fn)).rejects.toThrow("open 600");
    expect(skipped.calls()).toBe(0);
    now = 1_000;
    expect(breaker.state()).toBe("half-open");
    breaker.admit();
    expect(() => breaker.admit()).toThrow(CircuitOpenError);
    breaker.failure();
    expect(breaker.state()).toBe("open");
    now = 2_000;
    await expect(retry.run(failing(0).fn)).resolves.toBe("ok");
    expect(breaker.state()).toBe("closed");
  });

  it("is not tripped by errors the service answered with", async () => {
    const breaker = new CircuitBreaker(() => ({ failureThreshold: 1, cooldownMs: 1_000 }), () => 0);
    const { retry } = policy(0, { breaker });
    await expect(retry.run(failing(1, () => new Error("400")).fn, { shouldRetry: isTransient })).rejects.toThrow("400");
    expect(breaker.state()).toBe("closed");
    await expect(retry.run(failing(1).fn, { shouldRetry: isTransient })).rejects.toBeInstanceOf(Transient);
    await expect(retry.run(failing(0).fn)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
