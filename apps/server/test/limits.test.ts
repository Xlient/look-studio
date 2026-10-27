import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { resetRateLimiter } from "../src/lib/rate-limit.ts";
import {
  getDailySpendUsd,
  isSpendCapExceeded,
  recordSpend,
  resetSpendLedger,
} from "../src/lib/spend-cap.ts";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  resetRateLimiter();
  resetSpendLedger();
});

describe("per-IP rate limiter", () => {
  it("returns 429 after exceeding the per-IP max", async () => {
    process.env.RATE_LIMIT_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    resetRateLimiter();
    const app = createApp();
    const headers = { "x-forwarded-for": "203.0.113.7" };
    expect((await app.request("/health", { headers })).status).toBe(200);
    expect((await app.request("/health", { headers })).status).toBe(200);
    const limited = await app.request("/health", { headers });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("tracks IPs independently", async () => {
    process.env.RATE_LIMIT_MAX = "1";
    resetRateLimiter();
    const app = createApp();
    expect(
      (await app.request("/health", { headers: { "x-forwarded-for": "10.0.0.1" } })).status,
    ).toBe(200);
    expect(
      (await app.request("/health", { headers: { "x-forwarded-for": "10.0.0.2" } })).status,
    ).toBe(200);
  });
});

describe("daily spend cap", () => {
  it("returns 429 on model routes once the daily cap is reached", async () => {
    process.env.DAILY_SPEND_CAP_USD = "0.000001";
    process.env.MODEL_PRICE_PER_1K_TOKENS_USD = "1";
    resetSpendLedger();
    recordSpend(1000);
    expect(getDailySpendUsd()).toBeCloseTo(1, 6);
    expect(isSpendCapExceeded()).toBe(true);
    const res = await createApp().request("/api/ping-model");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("spend_cap_exceeded");
  });

  it("lets requests through under the cap (missing key yields 503, not 429)", async () => {
    process.env.DAILY_SPEND_CAP_USD = "5";
    delete process.env.MODEL_API_KEY;
    resetSpendLedger();
    const res = await createApp().request("/api/ping-model");
    expect(res.status).toBe(503);
  });
});
