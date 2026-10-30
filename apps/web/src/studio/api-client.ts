import { EditCommand, LookSpec } from "@look-studio/shared";
import type { WearableSpec } from "@look-studio/shared";
import { readSse } from "./sse.ts";
import { parseJobStatus } from "./wearable-jobs.ts";
import type { JobStatus } from "./wearable-jobs.ts";

export const REQUEST_TIMEOUT_MS = 45_000;
export const JOB_WATCH_TIMEOUT_MS = 300_000;

export interface CallMeta {
  model: string;
  latencyMs: number;
  tokens: { input: number; output: number; total: number };
  requestId: string | null;
  attempts: number;
}

export interface ApiFailure {
  ok: false;
  error: string;
  retryAfterS: number | null;
}

export type ApiResult<T> = { ok: true; data: T; meta: CallMeta } | ApiFailure;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  signal: AbortSignal;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseMeta(value: unknown): CallMeta | null {
  if (!isRecord(value) || !isRecord(value["tokens"])) {
    return null;
  }
  const { model, latencyMs, requestId, attempts } = value;
  const { input, output, total } = value["tokens"];
  if (
    typeof model !== "string" ||
    !isCount(latencyMs) ||
    !isCount(attempts) ||
    !(requestId === null || typeof requestId === "string") ||
    !isCount(input) ||
    !isCount(output) ||
    !isCount(total)
  ) {
    return null;
  }
  return { model, latencyMs, requestId, attempts, tokens: { input, output, total } };
}

function retryAfterSeconds(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return response.headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function resolveFetch(options: RequestOptions): FetchLike {
  return options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
}

function transportFailure(timeout: AbortSignal, signal: AbortSignal): ApiFailure {
  return { ok: false, error: timeout.aborted ? "timeout" : signal.aborted ? "aborted" : "network", retryAfterS: null };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  const payload = parseJson(await response.text().catch(() => ""));
  const error = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : "bad_response";
  return { ok: false, error, retryAfterS: retryAfterSeconds(response) };
}

async function postForPayload(
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<{ ok: true; payload: Record<string, unknown> } | ApiFailure> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await resolveFetch(options)(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([options.signal, timeout]),
    });
  } catch {
    return transportFailure(timeout, options.signal);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: "bad_response", retryAfterS: null };
  }
  if (!response.ok || !isRecord(payload) || payload["ok"] !== true) {
    const error = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : "bad_response";
    return { ok: false, error, retryAfterS: retryAfterSeconds(response) };
  }
  return { ok: true, payload };
}

async function postJson<T>(
  path: string,
  body: unknown,
  field: string,
  parse: (value: unknown) => T | null,
  options: RequestOptions,
): Promise<ApiResult<T>> {
  const result = await postForPayload(path, body, options);
  if (!result.ok) {
    return result;
  }
  const data = parse(result.payload[field]);
  const meta = parseMeta(result.payload["meta"]);
  if (data === null || meta === null) {
    return { ok: false, error: "bad_response", retryAfterS: null };
  }
  return { ok: true, data, meta };
}

function parseLook(value: unknown): LookSpec | null {
  const checked = LookSpec.safeParse(value);
  return checked.success ? checked.data : null;
}

function streamedResult(event: string, payload: unknown): ApiResult<LookSpec> | null {
  if (event === "look" && isRecord(payload)) {
    const look = parseLook(payload["look"]);
    const meta = parseMeta(payload["meta"]);
    return look === null || meta === null ? { ok: false, error: "bad_response", retryAfterS: null } : { ok: true, data: look, meta };
  }
  if (event === "error") {
    const error = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : "bad_response";
    const retryAfterS = isRecord(payload) && isCount(payload["retryAfterS"]) ? payload["retryAfterS"] : null;
    return { ok: false, error, retryAfterS };
  }
  return null;
}

export async function streamLook(
  input: { chat: string; image?: string },
  options: RequestOptions & { onText: (text: string) => void },
): Promise<ApiResult<LookSpec>> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await resolveFetch(options)("/api/look/stream", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal: AbortSignal.any([options.signal, timeout]),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("text/event-stream") || response.body === null) {
      return await failureFrom(response);
    }
    let result: ApiResult<LookSpec> = { ok: false, error: "bad_response", retryAfterS: null };
    await readSse(response.body, (event) => {
      const payload = parseJson(event.data);
      if (event.event === "delta" && isRecord(payload) && typeof payload["text"] === "string") {
        options.onText(payload["text"]);
        return;
      }
      result = streamedResult(event.event, payload) ?? result;
    });
    return result;
  } catch {
    return transportFailure(timeout, options.signal);
  }
}

export async function createWearableJob(
  wearable: WearableSpec,
  options: RequestOptions,
): Promise<{ ok: true; jobId: string } | ApiFailure> {
  const result = await postForPayload("/api/wearable", wearable, options);
  if (!result.ok) {
    return result;
  }
  const jobId = result.payload["jobId"];
  return typeof jobId === "string" && jobId !== "" ? { ok: true, jobId } : { ok: false, error: "bad_response", retryAfterS: null };
}

export async function watchWearableJob(
  jobId: string,
  options: RequestOptions & { onStatus: (status: JobStatus) => void },
): Promise<{ ok: true } | ApiFailure> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? JOB_WATCH_TIMEOUT_MS);
  try {
    const response = await resolveFetch(options)(`/api/wearable/${encodeURIComponent(jobId)}/events`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal: AbortSignal.any([options.signal, timeout]),
    });
    if (!response.ok || response.body === null) {
      return await failureFrom(response);
    }
    await readSse(response.body, (event) => {
      const status = parseJobStatus(parseJson(event.data));
      if (status !== null) {
        options.onStatus(status);
      }
    });
    return { ok: true };
  } catch {
    return transportFailure(timeout, options.signal);
  }
}

export function requestEdit(
  input: { utterance: string; look: LookSpec },
  options: RequestOptions,
): Promise<ApiResult<EditCommand>> {
  return postJson("/api/edit", input, "command", (value) => {
    const checked = EditCommand.safeParse(value);
    return checked.success ? checked.data : null;
  }, options);
}

export function errorMessage(error: string, retryAfterS: number | null): string {
  switch (error) {
    case "model_rate_limited":
    case "rate_limited":
      return retryAfterS === null
        ? "Too many requests right now. Try again in a moment."
        : `Too many requests right now. Try again in ${Math.ceil(retryAfterS)}s.`;
    case "spend_cap_exceeded":
      return "Today's model budget is used up. Try again tomorrow.";
    case "client_budget_exceeded":
      return "You've used up your model budget for today. Try again tomorrow.";
    case "edit_unresolved":
      return "I couldn't tell which item you meant. Try naming it, like \"the crown\".";
    case "model_timeout":
    case "timeout":
      return "Muse Spark took too long to answer. Try again.";
    case "invalid_request":
      return "That message couldn't be sent. Keep it under 2,000 characters.";
    case "skin_tone_change":
      return "Look Studio always keeps your own skin tone, so I can't change skin colour. Try a makeup or style idea instead.";
    case "body_too_large":
      return "That photo is too large. Try one under 3 MB.";
    case "aborted":
      return "Request cancelled.";
    case "network":
      return "Can't reach the Look Studio server. Is it running?";
    default:
      return "Something went wrong talking to the model. Try again.";
  }
}
