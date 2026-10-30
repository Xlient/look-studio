import { afterEach, describe, expect, it } from "vitest";
import type { BudgetTracker } from "@look-studio/shared";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { resetRateLimiter } from "../src/lib/rate-limit.ts";
import { resetSpendLedger } from "../src/lib/spend-cap.ts";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  resetRateLimiter();
  resetSpendLedger();
});

const jsonHeaders = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };

const look = { id: "look-1", name: "Evening", wearables: [], style: "casual" };
const wearable = { id: "w-1", type: "glasses", label: "Shades", anchor: { region: "face" } };

function post(app: ReturnType<typeof createApp>, path: string, payload: unknown) {
  return app.request(path, { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) });
}

describe("POST /api/look", () => {
  it("returns a LookSpec with or without an image", async () => {
    const app = createApp();
    const plain = await post(app, "/api/look", { chat: "red carpet look" });
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as { look: { id: string } }).look.id).toBe("look-fake-1");
    const withImage = await post(app, "/api/look", { chat: "match this", image: "data:image/png;base64,AAA" });
    expect(withImage.status).toBe(200);
  });

  it("rejects invalid bodies", async () => {
    const app = createApp();
    const missing = await post(app, "/api/look", {});
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("invalid_request");
    const malformed = await app.request("/api/look", {
      method: "POST",
      headers: jsonHeaders,
      body: "{oops",
    });
    expect(malformed.status).toBe(400);
  });
});

describe("skin tone requests", () => {
  it("refuses to change skin tone on look, stream, and edit routes before any model call", async () => {
    const app = createApp();
    for (const [path, payload] of [
      ["/api/look", { chat: "make me look Asian" }],
      ["/api/look/stream", { chat: "darken my skin like the photo", image: "data:image/png;base64,AAA" }],
      ["/api/edit", { utterance: "give me lighter skin", look }],
    ] as const) {
      const res = await post(app, path, payload);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe("skin_tone_change");
    }
  });
});

describe("POST /api/edit", () => {
  it("returns an EditCommand for a valid look", async () => {
    const res = await post(createApp(), "/api/edit", { utterance: "hide the glasses", look });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { command: { op: string } }).command.op).toBe("toggle");
  });

  it("rejects an invalid look", async () => {
    const res = await post(createApp(), "/api/edit", { utterance: "hide it", look: { id: "" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
  });
});

describe("POST /api/fit-check", () => {
  it("returns a CritiqueReport for stills plus a wearable id", async () => {
    const res = await post(createApp(), "/api/fit-check", { stills: ["aGVsbG8="], wearableId: "w-1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { report: { score: number } }).report.score).toBe(90);
  });

  it("rejects empty stills", async () => {
    const res = await post(createApp(), "/api/fit-check", { stills: [], wearableId: "w-1" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/wearable", () => {
  it("creates a job and returns its id", async () => {
    const res = await post(createApp(), "/api/wearable", wearable);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobId: string }).jobId).toMatch(/^job-fake-[0-9a-f-]{36}$/);
  });

  it("rejects an invalid spec", async () => {
    const res = await post(createApp(), "/api/wearable", { ...wearable, type: "car" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/wearable/:id/events", () => {
  it("streams JobStatus updates in order", async () => {
    const app = createApp();
    const created = await post(app, "/api/wearable", wearable);
    const { jobId } = (await created.json()) as { jobId: string };
    const events = await app.request(`/api/wearable/${jobId}/events`);
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const states = [...(await events.text()).matchAll(/data: (\{.*\})/g)].map(
      (match) => JSON.parse(match[1]) as { jobId: string; state: string },
    );
    expect(states.map((entry) => entry.state)).toEqual(["queued", "running", "succeeded"]);
    expect(states.every((entry) => entry.jobId === jobId)).toBe(true);
  });

  it("returns 404 for an unknown job", async () => {
    const res = await createApp().request("/api/wearable/nope/events");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("job_not_found");
  });
});

describe("limits", () => {
  it("rejects oversized bodies with 413", async () => {
    process.env.BODY_MAX_BYTES = "10";
    const res = await post(createApp(), "/api/look", { chat: "this body is far too long" });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("body_too_large");
  });

  it("rate limits new routes per IP", async () => {
    process.env.RATE_LIMIT_MAX = "1";
    resetRateLimiter();
    const app = createApp();
    expect((await post(app, "/api/look", { chat: "one" })).status).toBe(200);
    const limited = await post(app, "/api/look", { chat: "two" });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("hides a job from a different client", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const app = createApp();
    const created = await app.request("/api/wearable", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
      body: JSON.stringify(wearable),
    });
    const { jobId } = (await created.json()) as { jobId: string };
    const watch = (ip: string) => app.request(`/api/wearable/${jobId}/events`, { headers: { "x-forwarded-for": ip } });
    expect((await watch("203.0.113.2")).status).toBe(404);
    expect((await watch("203.0.113.1")).status).toBe(200);
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("rejects new routes once the budget is exceeded", async () => {
    const exceeded: BudgetTracker = { record: () => 0, remaining: () => 0, isExceeded: () => true };
    const app = createApp(createContainer({ budgetTracker: exceeded }));
    const res = await post(app, "/api/look", { chat: "over budget" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("spend_cap_exceeded");
  });
});

describe("secret safety", () => {
  it("never includes the API key in any response", async () => {
    process.env.MODEL_API_KEY = "SECRET-KEY-sweep";
    const app = createApp();
    const bodies: string[] = [];
    bodies.push(await (await post(app, "/api/look", { chat: "hi" })).text());
    bodies.push(await (await post(app, "/api/look", {})).text());
    bodies.push(await (await post(app, "/api/edit", { utterance: "x", look })).text());
    bodies.push(await (await post(app, "/api/fit-check", { stills: ["eA=="], wearableId: "w" })).text());
    bodies.push(await (await post(app, "/api/wearable", wearable)).text());
    bodies.push(await (await app.request("/api/wearable/nope/events")).text());
    process.env.BODY_MAX_BYTES = "10";
    bodies.push(await (await post(app, "/api/look", { chat: "way too long for ten bytes" })).text());
    expect(bodies.length).toBeGreaterThan(0);
    for (const text of bodies) {
      expect(text).not.toContain("SECRET-KEY-sweep");
    }
  });
});
