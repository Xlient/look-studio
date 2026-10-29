import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetTracker, LookSpec, RateLimiter } from "@look-studio/shared";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import type { FetchFn } from "../src/lib/model-client.ts";
import { ModelError } from "../src/lib/model-errors.ts";
import { MUSE_SPARK_MODEL, MuseEditService, MuseLookService } from "../src/lib/muse-services.ts";
import type { MuseServiceDeps } from "../src/lib/muse-services.ts";
import { BACKOFF_BASE_MS, ExponentialBackoffRetryPolicy } from "../src/lib/retry-policy.ts";
import { resetRateLimiter } from "../src/lib/rate-limit.ts";
import { EditUnresolvedError } from "../src/lib/services.ts";

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key-muse";
});

afterEach(() => {
  process.env = { ...savedEnv };
  resetRateLimiter();
});

const lookDraft = {
  name: "Gilded Hour",
  description: "Warm gold.",
  style: "formal",
  palette: ["#FFD700"],
  wearables: [{ type: "hat", label: "Crown", region: "head", scale: 1 }],  makeup: {
    lipColor: "#c2185b",
    lipOpacity: 0.7,
    lipFinish: "gloss",
    blushColor: "#ff8a80",
    blushOpacity: 0.3,
    shadowColor: "#7e57c2",
    shadowOpacity: 0.5,
    shadowFinish: "shimmer",
    browColor: "#4e342e",
    browOpacity: 0.4,
  },
};

const look: LookSpec = {
  id: "look-1",
  name: "Gilded Hour",
  style: "formal",
  wearables: [{ id: "look-1-w1", type: "hat", label: "Crown", anchor: { region: "head" } }],
};

function modelReply(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      id: "resp_9",
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      output_text: JSON.stringify(payload),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function recordingFetch(reply: () => Response, bodies: Record<string, unknown>[]): FetchFn {
  return async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return reply();
  };
}

function makeDeps(fetch: FetchFn, overrides: Partial<MuseServiceDeps> = {}) {
  const spent: number[] = [];
  const budget: BudgetTracker = {
    record: (cost) => {
      spent.push(cost);
      return cost;
    },
    remaining: () => 1,
    isExceeded: () => false,
  };
  const deps: MuseServiceDeps = {
    retryPolicy: new ExponentialBackoffRetryPolicy(
      () => ({ maxRetries: 0, baseMs: BACKOFF_BASE_MS }),
      () => Promise.resolve(),
      () => 0,
    ),
    rateLimiter: { tryAcquire: () => ({ allowed: true, retryAfterMs: 0 }) },
    budget,
    newId: () => "abc",
    fetch,
    ...overrides,
  };
  return { deps, spent };
}

const signal = new AbortController().signal;

describe("MuseLookService", () => {
  it("calls Muse Spark and returns a validated look with call meta", async () => {
    const bodies: Record<string, unknown>[] = [];
    const { deps, spent } = makeDeps(recordingFetch(() => modelReply(lookDraft), bodies));
    const result = await new MuseLookService(deps).createLook({ chat: "golden crown" }, signal);
    expect(result.data.id).toBe("look-abc");
    expect(result.data.wearables[0].id).toBe("look-abc-w1");
    expect(result.meta).toMatchObject({ model: MUSE_SPARK_MODEL, requestId: "resp_9", attempts: 1 });
    expect(result.meta.tokens.total).toBe(30);
    expect(bodies[0]["model"]).toBe(MUSE_SPARK_MODEL);
    expect(spent).toHaveLength(1);
  });

  it("asks for low reasoning effort unless LOOK_REASONING_EFFORT overrides it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const { deps } = makeDeps(recordingFetch(() => modelReply(lookDraft), bodies));
    await new MuseLookService(deps).createLook({ chat: "gold" }, signal);
    process.env.LOOK_REASONING_EFFORT = "minimal";
    await new MuseLookService(deps).createLook({ chat: "gold" }, signal);
    expect(bodies.map((body) => body["reasoning"])).toEqual([{ effort: "low" }, { effort: "minimal" }]);
  });

  it("rejects an unknown LOOK_REASONING_EFFORT before calling the model", async () => {
    process.env.LOOK_REASONING_EFFORT = "turbo";
    const bodies: Record<string, unknown>[] = [];
    const { deps } = makeDeps(recordingFetch(() => modelReply(lookDraft), bodies));
    await expect(new MuseLookService(deps).createLook({ chat: "gold" }, signal)).rejects.toThrow("LOOK_REASONING_EFFORT");
    expect(bodies).toHaveLength(0);
  });

  it("sends a reference photo as an image input", async () => {
    const bodies: Record<string, unknown>[] = [];
    const { deps } = makeDeps(recordingFetch(() => modelReply(lookDraft), bodies));
    await new MuseLookService(deps).createLook({ chat: "match", image: "data:image/png;base64,AAA" }, signal);
    expect(JSON.stringify(bodies[0]["input"])).toContain("input_image");
  });

  it("rejects output that does not match the draft schema", async () => {
    const { deps } = makeDeps(recordingFetch(() => modelReply({ name: "x" }), []));
    const error = await new MuseLookService(deps).createLook({ chat: "x" }, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("invalid_response");
  });

  it("stops before the network when the model rate limit is spent", async () => {
    const bodies: Record<string, unknown>[] = [];
    const denied: RateLimiter = { tryAcquire: () => ({ allowed: false, retryAfterMs: 1500 }) };
    const { deps } = makeDeps(recordingFetch(() => modelReply(lookDraft), bodies), { rateLimiter: denied });
    const error = await new MuseLookService(deps).createLook({ chat: "x" }, signal).catch((e: unknown) => e);
    expect((error as ModelError).kind).toBe("rate_limited");
    expect((error as ModelError).retryAfterMs).toBe(1500);
    expect(bodies).toHaveLength(0);
  });
});

describe("MuseEditService", () => {
  it("resolves an edit against the current look", async () => {
    const reply = { op: "recolor", targetId: "look-1-w1", color: "#ff0000", delta: null, factor: null, opacity: null, wearable: null };
    const { deps } = makeDeps(recordingFetch(() => modelReply(reply), []));
    const result = await new MuseEditService(deps).edit({ utterance: "make it red", look }, signal);
    expect(result.data).toEqual({ op: "recolor", targetId: "look-1-w1", color: "#ff0000" });
  });

  it("throws EditUnresolvedError for an unknown target", async () => {
    const reply = { op: "toggle", targetId: "ghost", color: null, delta: null, factor: null, opacity: null, wearable: null };
    const { deps } = makeDeps(recordingFetch(() => modelReply(reply), []));
    const error = await new MuseEditService(deps).edit({ utterance: "hide it", look }, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditUnresolvedError);
  });
});

describe("routes with Muse services", () => {
  const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" };

  function post(app: ReturnType<typeof createApp>, path: string, payload: unknown) {
    return app.request(path, { method: "POST", headers, body: JSON.stringify(payload) });
  }

  it("returns call meta with the look", async () => {
    const { deps } = makeDeps(recordingFetch(() => modelReply(lookDraft), []));
    const app = createApp(createContainer({ lookService: new MuseLookService(deps) }));
    const res = await post(app, "/api/look", { chat: "golden crown" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { model: string } };
    expect(body.meta.model).toBe(MUSE_SPARK_MODEL);
  });

  it("maps a provider 429 to 429 with Retry-After", async () => {
    const limited = () =>
      new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "2" },
      });
    const { deps } = makeDeps(recordingFetch(limited, []));
    const app = createApp(createContainer({ lookService: new MuseLookService(deps) }));
    const res = await post(app, "/api/look", { chat: "golden crown" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(((await res.json()) as { error: string }).error).toBe("model_rate_limited");
  });

  it("returns 422 when an edit cannot be resolved", async () => {
    const reply = { op: "toggle", targetId: "ghost", color: null, delta: null, factor: null, opacity: null, wearable: null };
    const { deps } = makeDeps(recordingFetch(() => modelReply(reply), []));
    const app = createApp(createContainer({ editService: new MuseEditService(deps) }));
    const res = await post(app, "/api/edit", { utterance: "hide it", look });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("edit_unresolved");
  });

  it("rejects images that are not base64 data URLs", async () => {
    const res = await post(createApp(), "/api/look", { chat: "match", image: "https://example.com/a.png" });
    expect(res.status).toBe(400);
  });
});
