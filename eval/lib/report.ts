import { columnsFor, toCsv } from "./csv.ts";
import type { Cell } from "./csv.ts";
import { errorText } from "./runner.ts";
import type { CaseRow, Harness } from "./runner.ts";

export interface RunInfo {
  suite: string;
  harness: string;
  casesFile: string;
  gitSha: string | null;
  nodeVersion: string;
  startedAt: Date;
  finishedAt: Date;
  concurrency: number;
  timeoutMs: number;
}

export function slug(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned === "" ? "eval" : cleaned;
}

export function runFolderName(suite: string, at: Date): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  return `${slug(suite)}-${stamp}`;
}

export function resultsCsv(rows: CaseRow[]): string {
  const flat = rows.map((row): Record<string, Cell> => ({
    caseId: row.caseId,
    status: row.status,
    ms: row.ms,
    error: row.error,
    ...row.fields,
  }));
  return toCsv(columnsFor(["caseId", "status", "ms", "error"], flat), flat);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function harnessSection(harness: Harness, rows: CaseRow[]): string {
  if (harness.summarize === undefined) {
    return "_The harness exports no `summarize`, so no metrics are reported._";
  }
  try {
    return harness.summarize(rows).trim() || "_`summarize` returned nothing._";
  } catch (error) {
    return `_\`summarize\` failed: ${errorText(error)}_`;
  }
}

export function summaryMarkdown(info: RunInfo, rows: CaseRow[], harness: Harness): string {
  const count = (status: CaseRow["status"]) => rows.filter((row) => row.status === status).length;
  const failures = rows.filter((row) => row.status !== "ok");
  const lines = [
    `# Eval run: ${info.suite}`,
    "",
    `- Harness: \`${info.harness}\``,
    `- Cases: \`${info.casesFile}\` (${rows.length})`,
    `- Results: ${count("ok")} ok, ${count("error")} error, ${count("timeout")} timeout`,
    `- Wall time: ${Math.round((info.finishedAt.getTime() - info.startedAt.getTime()) / 1000)} s; median case ${median(rows.map((row) => row.ms))} ms`,
    `- Commit: ${info.gitSha ?? "unknown"}; Node ${info.nodeVersion}; concurrency ${info.concurrency}; timeout ${info.timeoutMs} ms`,
    "",
    "## Metrics",
    "",
    harnessSection(harness, rows),
  ];
  if (failures.length > 0) {
    lines.push("", "## Failed cases", "", ...failures.slice(0, 50).map((row) => `- \`${row.caseId}\` (${row.status}): ${row.error ?? ""}`));
    if (failures.length > 50) {
      lines.push(`- …and ${failures.length - 50} more; see results.csv`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function runMetadata(info: RunInfo, rows: CaseRow[]): string {
  return `${JSON.stringify(
    {
      suite: info.suite,
      harness: info.harness,
      casesFile: info.casesFile,
      caseCount: rows.length,
      gitSha: info.gitSha,
      nodeVersion: info.nodeVersion,
      concurrency: info.concurrency,
      timeoutMs: info.timeoutMs,
      startedAt: info.startedAt.toISOString(),
      finishedAt: info.finishedAt.toISOString(),
    },
    null,
    2,
  )}\n`;
}
