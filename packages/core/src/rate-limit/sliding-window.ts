import { ALLOWED, SWEEP_EVERY } from "./decision.ts";
import type { RateLimitDecision } from "./decision.ts";

export interface SlidingWindowConfig {
  readonly max: number;
  readonly windowMs: number;
}

interface Log {
  at: number[];
  cost: number[];
  head: number;
  used: number;
}

function expire(log: Log, cutoff: number): void {
  while (log.head < log.at.length && (log.at[log.head] ?? 0) <= cutoff) {
    log.used -= log.cost[log.head] ?? 0;
    log.head += 1;
  }
  if (log.head > 64 && log.head * 2 > log.at.length) {
    log.at.splice(0, log.head);
    log.cost.splice(0, log.head);
    log.head = 0;
  }
}

export class SlidingWindowRateLimiter {
  private readonly logs = new Map<string, Log>();
  private readonly config: () => SlidingWindowConfig;
  private readonly now: () => number;
  private calls = 0;

  constructor(config: () => SlidingWindowConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  tryAcquire(key: string, cost: number): RateLimitDecision {
    const now = this.now();
    const { max, windowMs } = this.config();
    this.calls += 1;
    if (this.calls % SWEEP_EVERY === 0) {
      this.sweep(now - windowMs);
    }
    if (!(cost > 0)) {
      return ALLOWED;
    }
    if (cost > max) {
      return { allowed: false, retryAfterMs: windowMs };
    }
    let log = this.logs.get(key);
    if (log === undefined) {
      log = { at: [], cost: [], head: 0, used: 0 };
      this.logs.set(key, log);
    }
    expire(log, now - windowMs);
    if (log.used + cost <= max) {
      log.at.push(now);
      log.cost.push(cost);
      log.used += cost;
      return ALLOWED;
    }
    let freed = 0;
    let index = log.head;
    while (index < log.at.length && log.used - freed + cost > max) {
      freed += log.cost[index] ?? 0;
      index += 1;
    }
    const frees = log.at[index - 1] ?? now;
    return { allowed: false, retryAfterMs: Math.max(1, frees + windowMs - now) };
  }

  reset(): void {
    this.logs.clear();
  }

  private sweep(cutoff: number): void {
    for (const [key, log] of this.logs) {
      expire(log, cutoff);
      if (log.used <= 0) {
        this.logs.delete(key);
      }
    }
  }
}
