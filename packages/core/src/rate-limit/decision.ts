export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export const ALLOWED: RateLimitDecision = { allowed: true, retryAfterMs: 0 };

export const SWEEP_EVERY = 1_024;
