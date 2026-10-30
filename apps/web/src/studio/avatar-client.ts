import { AVATAR_CONCEPT_COUNT, AvatarCheck, AvatarConcept, AvatarJobStatus } from "@look-studio/shared";
import { failureFrom, postForPayload, resolveFetch, transportFailure } from "./api-client.ts";
import type { ApiFailure, RequestOptions } from "./api-client.ts";

// Hosting cuts requests at 60 s and three Muse Image drafts can take most of that.
export const CONCEPTS_TIMEOUT_MS = 58_000;
export const MODEL_TIMEOUT_MS = 60_000;
export const STATUS_TIMEOUT_MS = 10_000;
export const POLL_INTERVAL_MS = 2_000;
export const POLL_MAX_WAIT_MS = 16 * 60_000;
export const POLL_MAX_MISSES = 3;
export const MAX_MODEL_BYTES = 60_000_000;

const BAD_RESPONSE: ApiFailure = { ok: false, error: "bad_response", retryAfterS: null };

export async function requestConcepts(
  input: { description: string; photo?: string },
  options: RequestOptions,
): Promise<{ ok: true; concepts: AvatarConcept[] } | ApiFailure> {
  const result = await postForPayload("/api/avatar/concepts", input, { timeoutMs: CONCEPTS_TIMEOUT_MS, ...options });
  if (!result.ok) {
    return result;
  }
  const checked = AvatarConcept.array().min(1).max(AVATAR_CONCEPT_COUNT).safeParse(result.payload["concepts"]);
  return checked.success ? { ok: true, concepts: checked.data } : BAD_RESPONSE;
}

export async function requestAvatarCheck(
  renders: { front: string; side: string },
  options: RequestOptions,
): Promise<{ ok: true; check: AvatarCheck } | ApiFailure> {
  const result = await postForPayload("/api/avatar/check", renders, options);
  if (!result.ok) {
    return result;
  }
  const checked = AvatarCheck.safeParse(result.payload["check"]);
  return checked.success ? { ok: true, check: checked.data } : BAD_RESPONSE;
}

export async function startAvatar(conceptId: string, options: RequestOptions): Promise<{ ok: true; jobId: string } | ApiFailure> {
  const result = await postForPayload("/api/avatar", { conceptId }, options);
  if (!result.ok) {
    return result;
  }
  const jobId = result.payload["jobId"];
  return typeof jobId === "string" && jobId !== "" ? { ok: true, jobId } : BAD_RESPONSE;
}

async function getFrom(path: string, options: RequestOptions, defaultTimeoutMs: number): Promise<Response | ApiFailure> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs);
  try {
    const response = await resolveFetch(options)(path, { method: "GET", signal: AbortSignal.any([options.signal, timeout]) });
    return response.ok ? response : await failureFrom(response);
  } catch {
    return transportFailure(timeout, options.signal);
  }
}

export async function getAvatarStatus(jobId: string, options: RequestOptions): Promise<{ ok: true; status: AvatarJobStatus } | ApiFailure> {
  const response = await getFrom(`/api/avatar/${encodeURIComponent(jobId)}`, options, STATUS_TIMEOUT_MS);
  if (!(response instanceof Response)) {
    return response;
  }
  const payload: unknown = await response.json().catch(() => null);
  const checked = AvatarJobStatus.safeParse(typeof payload === "object" && payload !== null && "status" in payload ? payload.status : null);
  return checked.success && checked.data.jobId === jobId ? { ok: true, status: checked.data } : BAD_RESPONSE;
}

export async function downloadAvatarModel(jobId: string, options: RequestOptions): Promise<{ ok: true; model: ArrayBuffer } | ApiFailure> {
  const response = await getFrom(`/api/avatar/${encodeURIComponent(jobId)}/model`, options, MODEL_TIMEOUT_MS);
  if (!(response instanceof Response)) {
    return response;
  }
  try {
    const model = await response.arrayBuffer();
    return model.byteLength > 0 && model.byteLength <= MAX_MODEL_BYTES ? { ok: true, model } : BAD_RESPONSE;
  } catch {
    return BAD_RESPONSE;
  }
}

export interface PollOptions extends RequestOptions {
  onStatus: (status: AvatarJobStatus) => void;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

const isTransient = (failure: ApiFailure) => failure.error === "network" || failure.error === "timeout" || failure.error === "rate_limited";

export async function pollAvatarJob(jobId: string, options: PollOptions): Promise<{ ok: true } | ApiFailure> {
  const deadline = options.now() + POLL_MAX_WAIT_MS;
  let misses = 0;
  while (options.now() < deadline) {
    const result = await getAvatarStatus(jobId, options);
    if (options.signal.aborted) {
      return { ok: false, error: "aborted", retryAfterS: null };
    }
    if (result.ok) {
      misses = 0;
      options.onStatus(result.status);
      if (result.status.stage === "ready") {
        return { ok: true };
      }
      if (result.status.stage === "failed") {
        return { ok: false, error: "avatar_failed", retryAfterS: null };
      }
    } else if (!isTransient(result) || ++misses >= POLL_MAX_MISSES) {
      return result;
    }
    const waitMs = !result.ok && result.retryAfterS !== null ? result.retryAfterS * 1000 : POLL_INTERVAL_MS;
    try {
      await options.sleep(waitMs, options.signal);
    } catch {
      return { ok: false, error: "aborted", retryAfterS: null };
    }
  }
  return { ok: false, error: "timeout", retryAfterS: null };
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
