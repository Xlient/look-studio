import type { Context } from "hono";
import type { ZodError } from "zod";
import { envNumber } from "../env.ts";
import { ModelError } from "./model-errors.ts";
import { EditUnresolvedError } from "./services.ts";

export function maxBodyBytes(): number {
  return envNumber("BODY_MAX_BYTES", 5_000_000);
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; error: "body_too_large" | "invalid_json" };

export async function readJsonBody(c: Context): Promise<JsonBody> {
  const stated = c.req.header("content-length");
  if (stated !== undefined && Number(stated) > maxBodyBytes()) {
    return { ok: false, error: "body_too_large" };
  }
  const text = await c.req.text();
  if (text.length > maxBodyBytes()) {
    return { ok: false, error: "body_too_large" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export function invalidRequest(c: Context, error: ZodError): Response {
  return c.json(
    {
      ok: false,
      error: "invalid_request",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
    400,
  );
}

export function serviceError(c: Context): Response {
  return c.json({ ok: false, error: "service_error" }, 502);
}

export interface ModelErrorBody {
  status: 422 | 429 | 502 | 504;
  error: string;
  retryAfterS: number | null;
}

export function modelErrorBody(error: unknown): ModelErrorBody {
  if (error instanceof EditUnresolvedError) {
    return { status: 422, error: "edit_unresolved", retryAfterS: null };
  }
  if (error instanceof ModelError && error.kind === "rate_limited") {
    const retryAfterS = error.retryAfterMs === null ? null : Math.ceil(error.retryAfterMs / 1000);
    return { status: 429, error: "model_rate_limited", retryAfterS };
  }
  if (error instanceof ModelError && error.kind === "timeout") {
    return { status: 504, error: "model_timeout", retryAfterS: null };
  }
  return { status: 502, error: "service_error", retryAfterS: null };
}

export function modelErrorResponse(c: Context, error: unknown): Response {
  const body = modelErrorBody(error);
  if (body.retryAfterS !== null) {
    c.header("Retry-After", String(body.retryAfterS));
  }
  return c.json({ ok: false, error: body.error }, body.status);
}
