import { CircuitOpenError } from "./circuit-breaker.ts";
import type { CircuitBreaker } from "./circuit-breaker.ts";

export const BACKOFF_BASE_MS = 500;

export interface AbortSignalLike {
  readonly aborted: boolean;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface RetryRunOptions {
  readonly signal?: AbortSignalLike;
  readonly shouldRetry?: (error: unknown) => boolean;
}

export interface RetryPolicyConfig {
  maxRetries: number;
  baseMs: number;
  maxDelayMs?: number;
}

export interface RetryExtras {
  readonly breaker?: CircuitBreaker;
  readonly onOpen?: (error: CircuitOpenError) => unknown;
}

export function computeBackoffMs(attempt: number, random: () => number = Math.random, baseMs: number = BACKOFF_BASE_MS): number {
  return baseMs * 2 ** attempt + random() * baseMs;
}

export function retryAfterFrom(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "retryAfterMs" in error) {
    const value: unknown = error.retryAfterMs;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

export class ExponentialBackoffRetryPolicy {
  private readonly config: () => RetryPolicyConfig;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly extras: RetryExtras;

  constructor(config: () => RetryPolicyConfig, wait: (ms: number) => Promise<void>, random: () => number = Math.random, extras: RetryExtras = {}) {
    this.config = config;
    this.wait = wait;
    this.random = random;
    this.extras = extras;
  }

  async run<T>(fn: () => Promise<T>, options: RetryRunOptions = {}): Promise<T> {
    const { breaker, onOpen } = this.extras;
    try {
      breaker?.admit();
    } catch (error) {
      throw error instanceof CircuitOpenError && onOpen !== undefined ? onOpen(error) : error;
    }
    const { maxRetries, baseMs, maxDelayMs = Number.POSITIVE_INFINITY } = this.config();
    for (let attempt = 0; ; attempt += 1) {
      try {
        options.signal?.throwIfAborted();
        const result = await fn();
        breaker?.success();
        return result;
      } catch (error) {
        const transient = !(options.signal?.aborted ?? false) && (options.shouldRetry?.(error) ?? false);
        if (!transient || attempt >= maxRetries) {
          // Only transient failures mean the service is unhealthy; a rejected request still got an answer.
          if (transient) {
            breaker?.failure();
          } else {
            breaker?.success();
          }
          throw error;
        }
        const backoffMs = Math.min(maxDelayMs, computeBackoffMs(attempt, this.random, baseMs));
        await this.delay(Math.max(backoffMs, retryAfterFrom(error) ?? 0), options.signal);
      }
    }
  }

  private delay(ms: number, signal: AbortSignalLike | undefined): Promise<void> {
    if (ms <= 0 || signal?.aborted === true) {
      return Promise.resolve();
    }
    if (signal === undefined) {
      return this.wait(ms);
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", done);
          resolve();
        }
      };
      signal.addEventListener("abort", done, { once: true });
      void this.wait(ms).then(done, done);
    });
  }
}
