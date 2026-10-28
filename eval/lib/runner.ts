import type { Cell } from "./csv.ts";
import type { EvalCase } from "./cases.ts";
import { checkFields } from "./fields.ts";

export const MAX_CONCURRENCY = 8;

export type CaseStatus = "ok" | "error" | "timeout";

export interface CaseRow {
  caseId: string;
  status: CaseStatus;
  ms: number;
  error: string | null;
  fields: Record<string, Cell>;
}

export interface CaseContext {
  caseId: string;
  signal: AbortSignal;
}

export interface Harness {
  name: string;
  runCase: (input: unknown, ctx: CaseContext) => Promise<unknown>;
  summarize?: (rows: CaseRow[]) => string;
}

export interface RunOptions {
  concurrency: number;
  timeoutMs: number;
  now: () => number;
  signal: AbortSignal;
}

export type HarnessCheck = { ok: true; harness: Harness } | { ok: false; error: string };

export function checkHarness(module: unknown): HarnessCheck {
  if (typeof module !== "object" || module === null) {
    return { ok: false, error: "harness module did not load" };
  }
  const { name, runCase, summarize } = module as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, error: "harness must export a non-empty string `name`" };
  }
  if (typeof runCase !== "function") {
    return { ok: false, error: "harness must export an async function `runCase(input, ctx)`" };
  }
  if (summarize !== undefined && typeof summarize !== "function") {
    return { ok: false, error: "harness `summarize` must be a function when exported" };
  }
  return {
    ok: true,
    harness: {
      name,
      runCase: (input, ctx) => Promise.resolve(runCase(input, ctx)),
      ...(typeof summarize === "function" ? { summarize: (rows: CaseRow[]) => String(summarize(rows)) } : {}),
    },
  };
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 300);
}

class CaseTimeout extends Error {}

async function runOne(item: EvalCase, harness: Harness, options: RunOptions): Promise<CaseRow> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, options.signal]);
  const started = options.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Reject before aborting: a harness that settles on abort must not win the race.
      reject(new CaseTimeout());
      controller.abort();
    }, options.timeoutMs);
  });
  const row = (status: CaseStatus, error: string | null, fields: Record<string, Cell> = {}): CaseRow => ({
    caseId: item.id,
    status,
    ms: Math.max(0, Math.round(options.now() - started)),
    error,
    fields,
  });
  try {
    const result = await Promise.race([harness.runCase(item.input, { caseId: item.id, signal }), timeout]);
    if (timedOut) {
      return row("timeout", `timed out after ${options.timeoutMs} ms`);
    }
    const checked = checkFields(result);
    return checked.ok ? row("ok", null, checked.fields) : row("error", checked.error);
  } catch (error) {
    return error instanceof CaseTimeout ? row("timeout", `timed out after ${options.timeoutMs} ms`) : row("error", errorText(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function runCases(cases: EvalCase[], harness: Harness, options: RunOptions): Promise<CaseRow[]> {
  const rows: CaseRow[] = new Array<CaseRow>(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length && !options.signal.aborted) {
      const index = next;
      next += 1;
      const item = cases[index];
      if (item !== undefined) {
        rows[index] = await runOne(item, harness, options);
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(options.concurrency)), MAX_CONCURRENCY, cases.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return rows.filter((row): row is CaseRow => row !== undefined);
}
