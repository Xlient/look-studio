import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { forwardedClientIp, resetRateLimiter, trustedProxyHops } from "../src/lib/rate-limit.ts";
import {
  ClientBudgets,
  InMemoryBudgetTracker,
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
    process.env.TRUSTED_PROXY_HOPS = "1";
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

describe("forwardedClientIp", () => {
  it("reads the entry at the trusted hop count from the right", () => {
    expect(forwardedClientIp("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(forwardedClientIp("6.6.6.6, 203.0.113.7, 198.51.100.1", 2)).toBe("203.0.113.7");
  });

  it("ignores the header without trusted hops", () => {
    expect(forwardedClientIp("203.0.113.7", 0)).toBeNull();
  });

  it("rejects short, empty, and malformed headers", () => {
    expect(forwardedClientIp("203.0.113.7", 2)).toBeNull();
    expect(forwardedClientIp("", 1)).toBeNull();
    expect(forwardedClientIp("not-an-ip", 1)).toBeNull();
    expect(forwardedClientIp(undefined, 1)).toBeNull();
  });
});

describe("spoofed X-Forwarded-For", () => {
  it("cannot earn a new rate-limit bucket", async () => {
    process.env.RATE_LIMIT_MAX = "1";
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetRateLimiter();
    const app = createApp();
    const request = (spoof: string) => app.request("/health", { headers: { "x-forwarded-for": `${spoof}, 203.0.113.7` } });
    expect((await request("1.1.1.1")).status).toBe(200);
    expect((await request("2.2.2.2")).status).toBe(429);
  });

  it("is ignored when hops are invalid", () => {
    process.env.TRUSTED_PROXY_HOPS = "lots";
    expect(trustedProxyHops()).toBe(0);
  });
});

describe("ClientBudgets", () => {
  function budgets(day: () => string = () => "2026-01-01") {
    const global = new InMemoryBudgetTracker(() => 5, day);
    return { global, clients: new ClientBudgets(() => 0.5, global, day) };
  }

  it("blocks one client without blocking another", () => {
    const { clients } = budgets();
    clients.forClient("a").record(0.5);
    expect(clients.refusalFor("a")).toBe("client_budget_exceeded");
    expect(clients.refusalFor("b")).toBeNull();
  });

  it("counts client spend toward the global cap", () => {
    const { clients, global } = budgets();
    clients.forClient("a").record(0.25);
    expect(global.remaining()).toBeCloseTo(4.75, 6);
    global.record(5);
    expect(clients.refusalFor("b")).toBe("spend_cap_exceeded");
  });

  it("resets clients on a new UTC day", () => {
    let day = "2026-01-01";
    const { clients } = budgets(() => day);
    clients.forClient("a").record(0.5);
    day = "2026-01-02";
    expect(clients.refusalFor("a")).toBeNull();
  });

  it("returns 429 client_budget_exceeded from model routes", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const { clients } = budgets();
    clients.forClient("203.0.113.7").record(0.5);
    const app = createApp(createContainer({ clientBudgets: clients }));
    const res = await app.request("/api/look", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ chat: "gold" }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("client_budget_exceeded");
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
