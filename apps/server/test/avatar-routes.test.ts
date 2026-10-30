import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { AvatarStudio } from "../src/lib/avatar-studio.ts";
import { FakeAvatarProvider, FakeConceptService } from "../src/lib/avatar-fakes.ts";
import { InlineJobQueue } from "../src/lib/inline-job-queue.ts";
import { InMemoryRateLimiter, resetRateLimiter } from "../src/lib/rate-limit.ts";
import { resetSpendLedger } from "../src/lib/spend-cap.ts";
import type { ModerationService } from "../src/lib/moderation.ts";

afterEach(() => {
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
  it("draws concepts, builds an avatar, reports status, and serves the GLB once", async () => {
    const target = app();
    const jobId = await readyJob(target);
    const status = (await (await target.request(`/api/avatar/${jobId}`)).json()) as { status: { stage: string; progress: number } };
    expect(status.status).toEqual({ jobId, stage: "ready", progress: 100 });
    const events = await (await target.request(`/api/avatar/${jobId}/events`)).text();
    expect(events).toContain('"stage":"ready"');
    const model = await target.request(`/api/avatar/${jobId}/model`);
    expect(model.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new TextDecoder().decode(new Uint8Array(await model.arrayBuffer()).slice(0, 4))).toBe("glTF");
    expect((await target.request(`/api/avatar/${jobId}/model`)).status).toBe(404);
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
});
