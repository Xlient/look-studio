import type { Context } from "hono";
import type { ZodError } from "zod";
import { envNumber } from "../env.ts";

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
