import { afterEach, describe, expect, it } from "vitest";
import type { BudgetTracker } from "@look-studio/shared";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { FakeAvatarCheckService, MuseAvatarCheckService } from "../src/lib/avatar-check.ts";
import type { AvatarCheckService } from "../src/lib/avatar-check.ts";
import { defaultRetryPolicy } from "../src/lib/model-client.ts";
import { InMemoryRateLimiter, resetRateLimiter } from "../src/lib/rate-limit.ts";
import { ClientBudgets, InMemoryBudgetTracker, resetSpendLedger } from "../src/lib/spend-cap.ts";

afterEach(() => {
  resetRateLimiter();
  resetSpendLedger();
});

const IMAGE = "data:image/jpeg;base64,AAAA";
const headers = { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" };

function app(service: AvatarCheckService = new FakeAvatarCheckService(), max = 5, clientBudgets?: ClientBudgets) {
  return createApp(
    createContainer({
      avatarCheckService: service,
      avatarCheckLimiter: new InMemoryRateLimiter(() => ({ max, windowMs: 86_400_000 })),
      ...(clientBudgets === undefined ? {} : { clientBudgets }),
    }),
  );
}

const post = (target: ReturnType<typeof createApp>, body: unknown) =>
  target.request("/api/avatar/check", { method: "POST", headers, body: JSON.stringify(body) });

describe("POST /api/avatar/check", () => {
  it("returns the check", async () => {
    const res = await post(app(), { front: IMAGE, side: IMAGE });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { check: { usable: boolean } }).check.usable).toBe(true);
  });

  it("rejects missing or non-image renders", async () => {
    expect((await post(app(), { front: IMAGE })).status).toBe(400);
    expect((await post(app(), { front: "https://example.com/a.png", side: IMAGE })).status).toBe(400);
  });

  it("applies the daily limit with Retry-After", async () => {
    const target = app(new FakeAvatarCheckService(), 1);
    await post(target, { front: IMAGE, side: IMAGE });
    const res = await post(target, { front: IMAGE, side: IMAGE });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });
});

describe("POST /api/avatar/check spending", () => {
  function budgets(clientCap: number, globalCap: number) {
    return new ClientBudgets(() => clientCap, new InMemoryBudgetTracker(() => globalCap));
  }

  it("still runs after the client's budget is used up, and charges that client", async () => {
    const seen: BudgetTracker[] = [];
    const service: AvatarCheckService = {
      check: async (_renders, budget) => {
        seen.push(budget);
        budget.record(0.7);
        return new FakeAvatarCheckService().check();
      },
    };
    const target = app(service, 5, budgets(0.5, 100));
    expect((await post(target, { front: IMAGE, side: IMAGE })).status).toBe(200);
    expect((await post(target, { front: IMAGE, side: IMAGE })).status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.isExceeded()).toBe(true);
  });

  it("stops at the global cap", async () => {
    const shared = budgets(100, 1);
    shared.forClient("anyone").record(2);
    const res = await post(app(new FakeAvatarCheckService(), 5, shared), { front: IMAGE, side: IMAGE });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("spend_cap_exceeded");
  });
});

function modelResponse(output: unknown) {
  return new Response(
    JSON.stringify({
      id: "resp_1",
      object: "response",
      status: "completed",
      model: "muse-spark-1.3",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
      output_text: JSON.stringify(output),
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("MuseAvatarCheckService", () => {
  const deps = { retryPolicy: defaultRetryPolicy, rateLimiter: new InMemoryRateLimiter(() => ({ max: 10, windowMs: 1000 })), onTokens: () => {} };
  const signal = new AbortController().signal;
  const budget = new InMemoryBudgetTracker(() => 5);
  const renders = { front: IMAGE, side: IMAGE };
  const base = { usable: true, issue: "", faceFound: true, leftEyeX: 0.4, leftEyeY: 0.4, rightEyeX: 0.6, rightEyeY: 0.4, mouthX: 0.5, mouthY: 0.7 };

  it("clamps coordinates and trims the issue", async () => {
    const output = { ...base, leftEyeX: -3, mouthY: 9, issue: `  ${"x".repeat(300)}  ` };
    const service = new MuseAvatarCheckService({ ...deps, fetch: async () => modelResponse(output) });
    const check = await service.check(renders, budget, signal);
    expect(check.leftEyeX).toBe(0);
    expect(check.mouthY).toBe(1);
    expect(check.issue).toHaveLength(200);
  });

  it("charges the tokens to the budget it was given", async () => {
    const charged: { total: number; budget: unknown }[] = [];
    const service = new MuseAvatarCheckService({ ...deps, onTokens: (total, to) => charged.push({ total, budget: to }), fetch: async () => modelResponse(base) });
    await service.check(renders, budget, signal);
    expect(charged).toEqual([{ total: 2, budget }]);
  });

  it("rejects malformed model output", async () => {
    const service = new MuseAvatarCheckService({ ...deps, fetch: async () => modelResponse({ usable: "yes" }) });
    await expect(service.check(renders, budget, signal)).rejects.toMatchObject({ name: "ModelError" });
  });
});
