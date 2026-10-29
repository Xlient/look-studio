import type { Cell } from "./csv.ts";

export const MAX_FIELDS = 50;
export const MAX_STRING_LENGTH = 500;
export const RESERVED_FIELDS = ["caseId", "status", "ms", "error"] as const;

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const BASE64_RUN = /[A-Za-z0-9+/=]{200,}/;

export type FieldCheck = { ok: true; fields: Record<string, Cell> } | { ok: false; error: string };

function looksLikeImage(value: string): boolean {
  return /^data:/i.test(value.trim()) || BASE64_RUN.test(value);
}

export function checkFields(value: unknown): FieldCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "runCase must return an object of fields" };
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS) {
    return { ok: false, error: `runCase returned more than ${MAX_FIELDS} fields` };
  }
  const fields: Record<string, Cell> = {};
  for (const [key, field] of entries) {
    if (!FIELD_NAME.test(key) || (RESERVED_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `field name "${key.slice(0, 64)}" is not allowed` };
    }
    if (typeof field === "string") {
      if (field.length > MAX_STRING_LENGTH) {
        return { ok: false, error: `field "${key}" is longer than ${MAX_STRING_LENGTH} characters` };
      }
      if (looksLikeImage(field)) {
        return { ok: false, error: `field "${key}" looks like image data, which is never written to results` };
      }
      fields[key] = field;
    } else if ((typeof field === "number" && Number.isFinite(field)) || typeof field === "boolean" || field === null) {
      fields[key] = field;
    } else {
      return { ok: false, error: `field "${key}" must be a finite number, string, boolean, or null` };
    }
  }
  return { ok: true, fields };
}
