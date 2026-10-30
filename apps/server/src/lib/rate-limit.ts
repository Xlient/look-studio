import { isIP } from "node:net";
import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { RateLimitDecision, RateLimiter } from "@look-studio/shared";
import { envNumber } from "../env.ts";
import { logInfo } from "./logger.ts";

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

export function trustedProxyHops(): number {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(hops) && hops > 0 ? hops : 0;
}

// Entries left of the trusted hops are client-supplied, so only the rightmost hops can be believed.
export function forwardedClientIp(header: string | undefined, hops: number): string | null {
  if (header === undefined || hops < 1) {
    return null;
  }
  const entries = header.split(",").map((entry) => entry.trim());
  const candidate = entries[entries.length - hops];
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : null;
}

let warnedUnsetHops = false;

function warnIfHopsUnset(header: string | undefined, hops: number): void {
  if (header === undefined || hops > 0 || warnedUnsetHops) {
    return;
  }
  warnedUnsetHops = true;
  logInfo({ event: "trusted_proxy_hops_unset", forwardedEntries: header.split(",").length });
}

export function clientIp(c: Context): string {
  const header = c.req.header("x-forwarded-for");
  const hops = trustedProxyHops();
  warnIfHopsUnset(header, hops);
  const forwarded = forwardedClientIp(header, hops);
  if (forwarded !== null) {
    return forwarded;
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
