export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  tryAcquire(key: string, cost: number): RateLimitDecision;
}
