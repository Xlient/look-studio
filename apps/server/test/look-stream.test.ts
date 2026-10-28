import { afterEach, describe, expect, it } from "vitest";
import type { LookSpec } from "@look-studio/shared";
import { createApp } from "../src/app.ts";
import { createContainer } from "../src/container.ts";
import { callModelStructured } from "../src/lib/model-client.ts";
import type { FetchFn } from "../src/lib/model-client.ts";
import { ModelError } from "../src/lib/model-errors.ts";
import { createFieldStreamer, readPartialString } from "../src/lib/partial-json.ts";
import { resetRateLimiter } from "../src/lib/rate-limit.ts";
import { BACKOFF_BASE_MS, ExponentialBackoffRetryPolicy } from "../src/lib/retry-policy.ts";
import type { LookService } from "../src/lib/services.ts";
import { FAKE_META } from "../src/lib/services.ts";
import { resetSpendLedger } from "../src/lib/spend-cap.ts";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  resetRateLimiter();
  resetSpendLedger();
});

describe("readPartialString", () => {
  it("reads complete, partial, and missing values", () => {
    expect(readPartialString('{"name":"A","description":"Warm glow."}', "description")).toBe("Warm glow.");
    expect(readPartialString('{"name":"A","description":"Warm gl', "description")).toBe("Warm gl");
    expect(readPartialString('{"name":"A","descr', "description")).toBeNull();
    expect(readPartialString('{"description" : ""', "description")).toBe("");
  });

  it("decodes escapes and stops before an unfinished one", () => {
    expect(readPartialString('{"description":"say \\"hi\\"\\nnow \\u00e9"}', "description")).toBe('say "hi"\nnow é');
    expect(readPartialString('{"description":"a\\', "description")).toBe("a");
    expect(readPartialString('{"description":"a\\u00', "description")).toBe("a");
  });

  it("ignores the key when it appears inside another string", () => {
    expect(readPartialString('{"name":"the \\"description\\" look","description":"real"}', "description")).toBe("real");
  });
});

describe("createFieldStreamer", () => {
  it("emits only new text as chunks arrive", () => {
    const emitted: string[] = [];
    const push = createFieldStreamer("description", (text) => emitted.push(text));
    for (const chunk of ['{"name":"Gold', '","descri', 'ption":"Warm ', "gl", '\\u00', 'e9w."', ',"style":"casual"}']) {
      push(chunk);
    }
    expect(emitted).toEqual(["Warm ", "gl", "éw."]);
  });
});

function testPolicy(): ExponentialBackoffRetryPolicy {
  return new ExponentialBackoffRetryPolicy(
    () => ({ maxRetries: 2, baseMs: BACKOFF_BASE_MS }),
    () => Promise.resolve(),
    () => 0,
  );
}

function sseResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((event) => `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function streamingFetch(response: Response, bodies: Record<string, unknown>[]): FetchFn {
  return async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response;
  };
}

const completed = {
  type: "response.completed",
  response: { id: "resp_9", usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 } },
};

function streamOptions(fetch: FetchFn, deltas: string[]) {
  process.env.MODEL_API_KEY = "test-key-1";
  return {
    model: "muse-spark-1.3",
    prompt: "Make a look.",
    schemaName: "look_draft",
    schema: { type: "object" },
    signal: new AbortController().signal,
    retryPolicy: testPolicy(),
    fetch,
    onTextDelta: (delta: string) => deltas.push(delta),
  };
}

describe("callModelStructured streaming", () => {
  it("forwards deltas and parses the assembled output", async () => {
    const bodies: Record<string, unknown>[] = [];
    const deltas: string[] = [];
    const response = sseResponse([
      { type: "response.output_text.delta", delta: '{"pong":' },
      { type: "response.output_text.delta", delta: "true}" },
      completed,
    ]);
    const result = await callModelStructured<{ pong: boolean }>(streamOptions(streamingFetch(response, bodies), deltas));
    expect(bodies[0]?.["stream"]).toBe(true);
    expect(deltas).toEqual(['{"pong":', "true}"]);
    expect(result.data).toEqual({ pong: true });
    expect(result.tokens).toEqual({ input: 4, output: 6, total: 10 });
    expect(result.requestId).toBe("resp_9");
  });

  it("fails when the stream ends early or reports failure", async () => {
    for (const events of [
      [{ type: "response.output_text.delta", delta: "{" }],
      [{ type: "response.failed", response: { id: "resp_x" } }],
    ]) {
      const error = await callModelStructured(streamOptions(streamingFetch(sseResponse(events), []), [])).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).kind).toBe("invalid_response");
    }
  });
});

function streamApp(service: LookService) {
  return createApp(createContainer({ lookService: service }));
}

function postStream(app: ReturnType<typeof createApp>, payload: unknown) {
  return app.request("/api/look/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(payload),
  });
}

function sseEvents(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "null";
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe("POST /api/look/stream", () => {
  it("streams description deltas, then the validated look", async () => {
    const look: LookSpec = { id: "look-1", name: "Gold", description: "Warm glow.", wearables: [], style: "casual" };
    const service: LookService = {
      async createLook(_request, _signal, onDescription) {
        onDescription?.("Warm ");
        onDescription?.("glow.");
        return { data: look, meta: FAKE_META };
      },
    };
    const res = await postStream(streamApp(service), { chat: "gold" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(sseEvents(await res.text())).toEqual([
      { event: "delta", data: { text: "Warm " } },
      { event: "delta", data: { text: "glow." } },
      { event: "look", data: { look, meta: FAKE_META } },
    ]);
  });

  it("sends model errors as an error event with Retry-After seconds", async () => {
    const service: LookService = {
      async createLook() {
        throw new ModelError("rate_limited", { model: "muse-spark-1.3", retryAfterMs: 2500 });
      },
    };
    const events = sseEvents(await (await postStream(streamApp(service), { chat: "gold" })).text());
    expect(events).toEqual([{ event: "error", data: { error: "model_rate_limited", retryAfterS: 3 } }]);
  });

  it("rejects an invalid look from the service", async () => {
    const service: LookService = {
      async createLook() {
        return { data: { id: "" } as never, meta: FAKE_META };
      },
    };
    const events = sseEvents(await (await postStream(streamApp(service), { chat: "gold" })).text());
    expect(events).toEqual([{ event: "error", data: { error: "service_error", retryAfterS: null } }]);
  });

  it("validates the body before opening a stream", async () => {
    const res = await postStream(streamApp({ createLook: () => Promise.reject(new Error("unused")) }), { chat: "" });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
