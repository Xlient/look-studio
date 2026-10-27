import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";

export type ModelErrorKind =
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "aborted"
  | "auth"
  | "unavailable";

export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly model: string;

  constructor(
    kind: ModelErrorKind,
    fields: { model: string; status?: number | null; retryAfterMs?: number | null },
  ) {
    const status = fields.status ?? null;
    super(status === null ? kind : `${kind} (status ${status})`);
    this.name = "ModelError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = fields.retryAfterMs ?? null;
    this.model = fields.model;
  }
}

export function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return seconds * 1000;
}

export function toModelError(error: unknown, model: string, signal: AbortSignal | undefined): ModelError {
  if (error instanceof ModelError) {
    return error;
  }
  if (signal?.aborted || error instanceof APIUserAbortError) {
    return new ModelError("aborted", { model });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelError("timeout", { model });
  }
  if (error instanceof APIError) {
    const status = error.status ?? null;
    if (error.status === 429) {
      return new ModelError("rate_limited", {
        model,
        status,
        retryAfterMs: parseRetryAfterMs(error.headers?.get("retry-after")),
      });
    }
    if (error.status === 401 || error.status === 403) {
      return new ModelError("auth", { model, status });
    }
    return new ModelError("unavailable", { model, status });
  }
  if (error instanceof SyntaxError) {
    return new ModelError("invalid_response", { model });
  }
  return new ModelError("unavailable", { model });
}
