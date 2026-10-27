import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LookSpecJsonSchema } from "@look-studio/shared";
import {
  MODEL_API_BASE_URL,
  callModelJson,
  callModelStructured,
  callModelWithImage,
} from "../src/lib/model-client.ts";
import type { FetchFn } from "../src/lib/model-client.ts";
import { ModelError } from "../src/lib/model-errors.ts";
import { BACKOFF_BASE_MS, ExponentialBackoffRetryPolicy } from "../src/lib/retry-policy.ts";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

const sharedSchema = LookSpecJsonSchema as unknown as Record<string, unknown>;

function testPolicy(maxRetries = 3): ExponentialBackoffRetryPolicy {
  return new ExponentialBackoffRetryPolicy(
    () => ({ maxRetries, baseMs: BACKOFF_BASE_MS }),
    () => Promise.resolve(),
    () => 0,
  );
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

function scriptedFetch(script: Response[], captured: CapturedCall[]): FetchFn {
  let calls = 0;
  return async (input, init) => {
    const template = script[Math.min(calls, script.length - 1)];
    calls += 1;
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return template.clone();
  };
}

function jsonResponse(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function modelResponse(outputText: string): Response {
  return jsonResponse({
    id: "resp_123",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    output_text: outputText,
  }, 200);
}

function baseOptions<T extends Record<string, unknown> = {}>(overrides: T = {} as T) {
  return {
    model: "muse-spark-1.3",
    prompt: "Say pong.",
    schemaName: "ping_result",
    schema: sharedSchema,
    signal: new AbortController().signal,
    retryPolicy: testPolicy(),
    ...overrides,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("callModelStructured", () => {
  it("sends text.format with the shared schema and parses the result", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const result = await callModelStructured<{ pong: boolean }>(baseOptions({
      fetch: scriptedFetch([modelResponse('{"pong":true}')], captured),
    }));
    expect(result.data).toEqual({ pong: true });
    expect(result.tokens).toEqual({ input: 10, output: 5, total: 15 });
    expect(result.requestId).toBe("resp_123");
    expect(result.model).toBe("muse-spark-1.3");
    expect(result.attempts).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].url.startsWith(MODEL_API_BASE_URL)).toBe(true);
    expect(captured[0].authorization).toBe("Bearer test-key-1");
    const body = captured[0].body;
    expect(body["model"]).toBe("muse-spark-1.3");
    expect(body["input"]).toBe("Say pong.");
    expect(body["text"]).toEqual({
      format: { type: "json_schema", name: "ping_result", schema: sharedSchema, strict: true },
    });
  });

  it("retries a 429 with Retry-After and then succeeds", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const result = await callModelStructured<{ pong: boolean }>(baseOptions({
      fetch: scriptedFetch([
        jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "1" }),
        modelResponse('{"pong":true}'),
      ], captured),
    }));
    expect(result.data).toEqual({ pong: true });
    expect(result.attempts).toBe(2);
    expect(captured).toHaveLength(2);
  });

  it("throws a typed rate_limited error once retries run out", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      retryPolicy: testPolicy(1),
      fetch: scriptedFetch([
        jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "2" }),
      ], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    const typed = error as ModelError;
    expect(typed.kind).toBe("rate_limited");
    expect(typed.status).toBe(429);
    expect(typed.retryAfterMs).toBe(2000);
    expect(captured).toHaveLength(2);
  });

  it("maps a hanging request to a timeout", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const hanging: FetchFn = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      retryPolicy: testPolicy(0),
      timeoutMs: 10,
      fetch: hanging,
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("timeout");
  });

  it("maps invalid JSON to invalid_response", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      fetch: scriptedFetch([modelResponse("not json{{{")], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("invalid_response");
    expect(captured).toHaveLength(1);
  });

  it("maps a missing output_text to invalid_response", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      fetch: scriptedFetch([
        jsonResponse({ id: "resp_123", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }, 200),
      ], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("invalid_response");
  });

  it("maps 401 to auth", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      fetch: scriptedFetch([jsonResponse({ error: { message: "bad key" } }, 401)], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    const typed = error as ModelError;
    expect(typed.kind).toBe("auth");
    expect(typed.status).toBe(401);
    expect(captured).toHaveLength(1);
  });

  it("aborts before sending when already aborted", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const controller = new AbortController();
    controller.abort();
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      signal: controller.signal,
      fetch: scriptedFetch([modelResponse('{"pong":true}')], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("aborted");
    expect(captured).toHaveLength(0);
  });

  it("aborts a hanging request mid-flight", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const controller = new AbortController();
    const hanging: FetchFn = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    setTimeout(() => controller.abort(), 5);
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      signal: controller.signal,
      fetch: hanging,
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("aborted");
  });

  it("keeps prompts and keys out of errors", async () => {
    process.env.MODEL_API_KEY = "SECRET-KEY-xyz";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      prompt: "SECRET-PROMPT-xyz",
      fetch: scriptedFetch([modelResponse("not json{{{")], captured),
    })));
    const text = String(error);
    expect(text).not.toContain("SECRET-PROMPT-xyz");
    expect(text).not.toContain("SECRET-KEY-xyz");
  });
});

describe("model call logging", () => {
  it("logs one line with usage and no prompt on success", async () => {
    process.env.MODEL_API_KEY = "SECRET-KEY-xyz";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const captured: CapturedCall[] = [];
    await callModelStructured<{ pong: boolean }>(baseOptions({
      prompt: "SECRET-PROMPT-xyz",
      fetch: scriptedFetch([modelResponse('{"pong":true}')], captured),
    }));
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("SECRET-PROMPT-xyz");
    expect(line).not.toContain("SECRET-KEY-xyz");
    const fields = JSON.parse(line) as Record<string, unknown>;
    expect(fields["model"]).toBe("muse-spark-1.3");
    expect(fields["inputTokens"]).toBe(10);
    expect(fields["outputTokens"]).toBe(5);
    expect(fields["totalTokens"]).toBe(15);
    expect(fields["requestId"]).toBe("resp_123");
    expect(typeof fields["latencyMs"]).toBe("number");
  });

  it("logs one line with the error kind on failure", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const captured: CapturedCall[] = [];
    await captureError(callModelStructured<{ pong: boolean }>(baseOptions({
      retryPolicy: testPolicy(0),
      fetch: scriptedFetch([jsonResponse({ error: { message: "bad key" } }, 401)], captured),
    })));
    expect(spy).toHaveBeenCalledTimes(1);
    const fields = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(fields["error"]).toBe("auth");
    expect(fields["model"]).toBe("muse-spark-1.3");
  });
});

describe("callModelJson", () => {
  const PingResult = z.object({ pong: z.boolean() });

  it("returns validated data on a matching response", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const result = await callModelJson(baseOptions({
      parse: (data: unknown) => PingResult.parse(data),
      fetch: scriptedFetch([modelResponse('{"pong":true}')], captured),
    }));
    expect(result.data).toEqual({ pong: true });
  });

  it("maps a schema mismatch to invalid_response", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const error = await captureError(callModelJson(baseOptions({
      parse: (data: unknown) => PingResult.parse(data),
      fetch: scriptedFetch([modelResponse('{"nope":1}')], captured),
    })));
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("invalid_response");
  });
});

describe("callModelWithImage", () => {
  it("sends text plus input_image blocks", async () => {
    process.env.MODEL_API_KEY = "test-key-1";
    const captured: CapturedCall[] = [];
    const result = await callModelWithImage<{ pong: boolean }>(baseOptions({
      images: [{ dataUrl: "data:image/png;base64,AAA" }],
      fetch: scriptedFetch([modelResponse('{"pong":true}')], captured),
    }));
    expect(result.data).toEqual({ pong: true });
    expect(captured).toHaveLength(1);
    expect(captured[0].body["input"]).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Say pong." },
          { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
        ],
      },
    ]);
  });
});
