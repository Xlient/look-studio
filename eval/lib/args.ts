import { parseArgs } from "node:util";
import { MAX_CONCURRENCY } from "./runner.ts";

export interface EvalOptions {
  harness: string;
  cases: string;
  suite: string | null;
  concurrency: number;
  timeoutMs: number;
  out: string;
}

export const USAGE =
  "usage: pnpm eval --harness <file.ts> --cases <cases.json> [--suite name] [--concurrency 1-8] [--timeout-ms 60000] [--out eval/results]";

export type ArgsResult = { ok: true; options: EvalOptions } | { ok: false; error: string };

function integer(raw: string | undefined, fallback: number, min: number, max: number, flag: string): number | string {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : `${flag} must be a whole number from ${min} to ${max}`;
}

export function parseEvalArgs(argv: string[]): ArgsResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        harness: { type: "string" },
        cases: { type: "string" },
        suite: { type: "string" },
        concurrency: { type: "string" },
        "timeout-ms": { type: "string" },
        out: { type: "string" },
      },
    }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "could not read arguments" };
  }
  if (values.harness === undefined || values.cases === undefined) {
    return { ok: false, error: "--harness and --cases are required" };
  }
  const concurrency = integer(values.concurrency, 1, 1, MAX_CONCURRENCY, "--concurrency");
  const timeoutMs = integer(values["timeout-ms"], 60_000, 100, 600_000, "--timeout-ms");
  if (typeof concurrency === "string" || typeof timeoutMs === "string") {
    return { ok: false, error: typeof concurrency === "string" ? concurrency : String(timeoutMs) };
  }
  const suite = values.suite === undefined ? null : values.suite;
  return {
    ok: true,
    options: { harness: values.harness, cases: values.cases, suite, concurrency, timeoutMs, out: values.out ?? "eval/results" },
  };
}
