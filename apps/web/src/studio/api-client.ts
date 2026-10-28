import { EditCommand, LookSpec } from "@look-studio/shared";

export const REQUEST_TIMEOUT_MS = 45_000;

export interface CallMeta {
  model: string;
  latencyMs: number;
  tokens: { input: number; output: number; total: number };
  requestId: string | null;
  attempts: number;
}

export type ApiResult<T> =
  | { ok: true; data: T; meta: CallMeta }
  | { ok: false; error: string; retryAfterS: number | null };

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

async function postJson<T>(
  path: string,
  body: unknown,
  field: string,
  parse: (value: unknown) => T | null,
  options: RequestOptions,
): Promise<ApiResult<T>> {
  const fetchFn = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchFn(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([options.signal, timeout]),
    });
  } catch {
    return { ok: false, error: timeout.aborted ? "timeout" : options.signal.aborted ? "aborted" : "network", retryAfterS: null };
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
  const data = parse(payload[field]);
  const meta = parseMeta(payload["meta"]);
  if (data === null || meta === null) {
    return { ok: false, error: "bad_response", retryAfterS: null };
  }
  return { ok: true, data, meta };
}

export function requestLook(
  input: { chat: string; image?: string },
  options: RequestOptions,
): Promise<ApiResult<LookSpec>> {
  return postJson("/api/look", input, "look", (value) => {
    const checked = LookSpec.safeParse(value);
    return checked.success ? checked.data : null;
  }, options);
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
    case "edit_unresolved":
      return "I couldn't tell which item you meant. Try naming it, like \"the crown\".";
    case "model_timeout":
    case "timeout":
      return "Muse Spark took too long to answer. Try again.";
    case "invalid_request":
      return "That message couldn't be sent. Keep it under 2,000 characters.";
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
