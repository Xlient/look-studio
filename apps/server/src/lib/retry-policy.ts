import type { RetryOptions, RetryPolicy } from "@look-studio/shared";

export const BACKOFF_BASE_MS = 500;

export function computeBackoffMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs: number = BACKOFF_BASE_MS,
): number {
  return baseMs * 2 ** attempt + random() * baseMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorRetryAfterMs(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "retryAfterMs" in error) {
    const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

export interface RetryPolicyConfig {
  maxRetries: number;
  baseMs: number;
}

export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  private readonly config: () => RetryPolicyConfig;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    config: () => RetryPolicyConfig,
    wait: (ms: number) => Promise<void> = sleep,
    random: () => number = Math.random,
  ) {
    this.config = config;
    this.wait = wait;
    this.random = random;
  }

  async run<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { maxRetries, baseMs } = this.config();
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        return await fn();
      } catch (error) {
        const retry = attempt < maxRetries && (options.shouldRetry?.(error) ?? false);
        if (!retry) {
          throw error;
        }
        const backoffMs = computeBackoffMs(attempt, this.random, baseMs);
        await this.delay(Math.max(backoffMs, errorRetryAfterMs(error) ?? 0), options.signal);
      }
    }
  }

  private delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (ms <= 0 || signal?.aborted) {
      return Promise.resolve();
    }
    const active = signal;
    if (active === undefined) {
      return this.wait(ms);
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          active.removeEventListener("abort", done);
          resolve();
        }
      };
      active.addEventListener("abort", done, { once: true });
      void this.wait(ms).then(done, done);
    });
  }
}
