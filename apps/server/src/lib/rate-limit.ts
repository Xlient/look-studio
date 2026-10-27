import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { RateLimitDecision, RateLimiter } from "@look-studio/shared";
import { envNumber } from "../env.ts";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterConfig {
  readonly max: number;
  readonly windowMs: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: () => RateLimiterConfig;
  private readonly now: () => number;

  constructor(config: () => RateLimiterConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  tryAcquire(key: string, cost: number): RateLimitDecision {
    const now = this.now();
    const { max, windowMs } = this.config();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: cost, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    bucket.count += cost;
    if (bucket.count > max) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}

const limiter = new InMemoryRateLimiter(() => ({
  max: rateLimitMax(),
  windowMs: rateLimitWindowMs(),
}));

export const defaultRateLimiter: RateLimiter = limiter;

export function resetRateLimiter(): void {
  limiter.reset();
}

export function rateLimitMax(): number {
  return envNumber("RATE_LIMIT_MAX", 60);
}

export function rateLimitWindowMs(): number {
  return envNumber("RATE_LIMIT_WINDOW_MS", 60_000);
}

export function clientIp(c: Context): string {
  const first = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) {
    return first;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createRateLimitMiddleware(
  active: RateLimiter,
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    const decision = active.tryAcquire(clientIp(c), 1);
    if (!decision.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    return next();
  };
}

export const rateLimit = createRateLimitMiddleware(defaultRateLimiter);
