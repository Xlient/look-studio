import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { AvatarStudio } from "../src/lib/avatar-studio.ts";
import { FakeAvatarProvider, FakeConceptService } from "../src/lib/avatar-fakes.ts";
import { InlineJobQueue } from "../src/lib/inline-job-queue.ts";
import { InMemoryRateLimiter, resetRateLimiter } from "../src/lib/rate-limit.ts";
import { ClientBudgets, InMemoryBudgetTracker, resetSpendLedger } from "../src/lib/spend-cap.ts";
import type { ModerationService } from "../src/lib/moderation.ts";

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  resetRateLimiter();
  resetSpendLedger();
});

const headers = { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };

function app(moderation: ModerationService = { check: async () => ({ allowed: true, category: "ok" }) }, dailyMax = 3) {
  let id = 0;
  const avatarService = new AvatarStudio({
    moderation,
    concepts: new FakeConceptService(),
    provider: new FakeAvatarProvider(),
    queue: new InlineJobQueue(),
    now: Date.now,
    newId: () => String((id += 1)),
    onAvatarBuilt: () => {},
  });
  const avatarLimiter = new InMemoryRateLimiter(() => ({ max: dailyMax, windowMs: 86_400_000 }));
  return createApp(createContainer({ avatarService, avatarLimiter }));
}

const post = (target: ReturnType<typeof createApp>, path: string, body: unknown) =>
  target.request(path, { method: "POST", headers, body: JSON.stringify(body) });

async function readyJob(target: ReturnType<typeof createApp>): Promise<string> {
  const concepts = (await (await post(target, "/api/avatar/concepts", { description: "grumpy robot barista" })).json()) as {
    concepts: { id: string }[];
  };
  const started = (await (await post(target, "/api/avatar", { conceptId: concepts.concepts[0]?.id })).json()) as { jobId: string };
  await new Promise((resolve) => setTimeout(resolve, 0));
  return started.jobId;
}

describe("avatar routes", () => {
  it("draws concepts, builds an avatar, reports status, and serves the GLB for retries", async () => {
    const target = app();
    const jobId = await readyJob(target);
    const status = (await (await target.request(`/api/avatar/${jobId}`)).json()) as { status: { stage: string; progress: number } };
    expect(status.status).toEqual({ jobId, stage: "ready", progress: 100 });
    const events = await (await target.request(`/api/avatar/${jobId}/events`)).text();
    expect(events).toContain('"stage":"ready"');
    const model = await target.request(`/api/avatar/${jobId}/model`);
    expect(model.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new TextDecoder().decode(new Uint8Array(await model.arrayBuffer()).slice(0, 4))).toBe("glTF");
    expect((await target.request(`/api/avatar/${jobId}/model`)).status).toBe(200);
  });

  it("blocks unsafe descriptions with the category", async () => {
    const res = await post(app({ check: async () => ({ allowed: false, category: "sexual" }) }), "/api/avatar/concepts", {
      description: "x",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "avatar_blocked", category: "sexual" });
  });

  it("rejects bad bodies, unknown concepts, and unknown jobs", async () => {
    const target = app();
    expect((await post(target, "/api/avatar/concepts", { description: "" })).status).toBe(400);
    expect((await post(target, "/api/avatar/concepts", { description: "x", photo: "https://example.com/me.png" })).status).toBe(400);
    expect((await post(target, "/api/avatar", { conceptId: "concept-forged" })).status).toBe(404);
    expect((await target.request("/api/avatar/avatar-missing")).status).toBe(404);
    expect((await target.request("/api/avatar/avatar-missing/events")).status).toBe(404);
  });

  it("limits avatars per IP per day", async () => {
    const target = app(undefined, 1);
    await readyJob(target);
    const res = await post(target, "/api/avatar", { conceptId: "concept-any" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(await res.json()).toEqual({ ok: false, error: "avatar_daily_limit" });
  });

  it("hides another client's concept, status, events, and model", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const target = app();
    const as = (ip: string) => ({ "content-type": "application/json", "x-forwarded-for": ip });
    const owner = as("198.51.100.1");
    const other = as("198.51.100.2");
    const drawn = await target.request("/api/avatar/concepts", {
      method: "POST",
      headers: owner,
      body: JSON.stringify({ description: "robot" }),
    });
    const { concepts } = (await drawn.json()) as { concepts: { id: string }[] };
    const start = (headers: Record<string, string>) =>
      target.request("/api/avatar", { method: "POST", headers, body: JSON.stringify({ conceptId: concepts[0]?.id }) });
    expect((await start(other)).status).toBe(404);
    const { jobId } = (await (await start(owner)).json()) as { jobId: string };
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const path of [`/api/avatar/${jobId}`, `/api/avatar/${jobId}/events`, `/api/avatar/${jobId}/model`]) {
      expect((await target.request(path, { headers: other })).status).toBe(404);
    }
    expect((await target.request(`/api/avatar/${jobId}/model`, { headers: owner })).status).toBe(200);
  });

  it("refuses new avatars over the client budget but still serves the paid-for model", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const clientBudgets = new ClientBudgets(() => 0.5, new InMemoryBudgetTracker(() => 5));
    const avatarService = new AvatarStudio({
      moderation: { check: async () => ({ allowed: true, category: "ok" }) },
      concepts: new FakeConceptService(),
      provider: new FakeAvatarProvider(),
      queue: new InlineJobQueue(),
      now: Date.now,
      newId: () => crypto.randomUUID(),
      onAvatarBuilt: (budget) => void budget.record(0.7),
    });
    const target = createApp(createContainer({ avatarService, clientBudgets }));
    const jobId = await readyJob(target);
    const over = await post(target, "/api/avatar/concepts", { description: "another" });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe("client_budget_exceeded");
    const model = await target.request(`/api/avatar/${jobId}/model`, { headers });
    expect(model.status).toBe(200);
    const elsewhere = await target.request("/api/avatar/concepts", {
      method: "POST",
      headers: { ...headers, "x-forwarded-for": "198.51.100.8" },
      body: JSON.stringify({ description: "another" }),
    });
    expect(elsewhere.status).toBe(200);
  });
});
