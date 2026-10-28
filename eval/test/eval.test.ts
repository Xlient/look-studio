import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseEvalArgs } from "../lib/args.ts";
import { parseCases } from "../lib/cases.ts";
import { columnsFor, csvCell, toCsv } from "../lib/csv.ts";
import type { Cell } from "../lib/csv.ts";
import { checkFields } from "../lib/fields.ts";
import { resultsCsv, runFolderName, summaryMarkdown } from "../lib/report.ts";
import type { RunInfo } from "../lib/report.ts";
import { checkHarness, runCases } from "../lib/runner.ts";
import type { CaseRow, Harness, RunOptions } from "../lib/runner.ts";
import { runEval } from "../run.ts";

describe("csv", () => {
  it("escapes commas, quotes, newlines, edge spaces, and formula starts", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(false)).toBe("false");
  });

  it("keeps fixed columns first and sorts the rest", () => {
    const rows: Record<string, Cell>[] = [{ caseId: "a", zeta: 1 }, { caseId: "b", alpha: true }];
    const columns = columnsFor(["caseId"], rows);
    expect(columns).toEqual(["caseId", "alpha", "zeta"]);
    expect(toCsv(columns, rows)).toBe("caseId,alpha,zeta\r\na,,1\r\nb,true,\r\n");
  });
});

describe("field guard", () => {
  it("accepts scalar fields", () => {
    expect(checkFields({ score: 0.8, passed: true, note: "fine", missing: null })).toEqual({
      ok: true,
      fields: { score: 0.8, passed: true, note: "fine", missing: null },
    });
  });

  it("refuses image data, long strings, objects, and reserved names", () => {
    expect(checkFields({ frame: "data:image/png;base64,AAAA" })).toMatchObject({ ok: false });
    expect(checkFields({ blob: "A".repeat(300) })).toMatchObject({ ok: false });
    expect(checkFields({ note: "x ".repeat(300) })).toMatchObject({ ok: false });
    expect(checkFields({ nested: { a: 1 } })).toMatchObject({ ok: false });
    expect(checkFields({ score: Number.POSITIVE_INFINITY })).toMatchObject({ ok: false });
    expect(checkFields({ status: "ok" })).toMatchObject({ ok: false });
    expect(checkFields({ "bad name": 1 })).toMatchObject({ ok: false });
    expect(checkFields([1, 2])).toMatchObject({ ok: false });
  });
});

describe("cases and args", () => {
  it("parses cases and rejects duplicates or bad shapes", () => {
    expect(parseCases('[{"id":"a","input":1}]')).toEqual({ ok: true, cases: [{ id: "a", input: 1 }] });
    expect(parseCases("{")).toMatchObject({ ok: false });
    expect(parseCases("[]")).toMatchObject({ ok: false });
    expect(parseCases('[{"id":"a","input":1},{"id":"a","input":2}]')).toMatchObject({ ok: false, error: expect.stringContaining('"a"') });
    expect(parseCases('[{"id":"","input":1}]')).toMatchObject({ ok: false });
    expect(parseCases('[{"id":"a"}]')).toMatchObject({ ok: false });
  });

  it("parses flags with defaults and bounds", () => {
    expect(parseEvalArgs(["--harness", "h.ts", "--cases", "c.json"])).toEqual({
      ok: true,
      options: { harness: "h.ts", cases: "c.json", suite: null, concurrency: 1, timeoutMs: 60_000, out: "eval/results" },
    });
    expect(parseEvalArgs(["--cases", "c.json"])).toMatchObject({ ok: false });
    expect(parseEvalArgs(["--harness", "h", "--cases", "c", "--concurrency", "9"])).toMatchObject({ ok: false });
    expect(parseEvalArgs(["--harness", "h", "--cases", "c", "--timeout-ms", "abc"])).toMatchObject({ ok: false });
    expect(parseEvalArgs(["--harness", "h", "--cases", "c", "--nope"])).toMatchObject({ ok: false });
  });
});

function fakeClock(): () => number {
  let t = 0;
  return () => {
    t += 5;
    return t;
  };
}

function options(overrides: Partial<RunOptions> = {}): RunOptions {
  return { concurrency: 1, timeoutMs: 1_000, now: fakeClock(), signal: new AbortController().signal, ...overrides };
}

describe("runner", () => {
  it("checks harness exports", () => {
    expect(checkHarness({ name: "x", runCase: async () => ({}) })).toMatchObject({ ok: true });
    expect(checkHarness({ runCase: async () => ({}) })).toMatchObject({ ok: false });
    expect(checkHarness({ name: "x" })).toMatchObject({ ok: false });
    expect(checkHarness({ name: "x", runCase: async () => ({}), summarize: 3 })).toMatchObject({ ok: false });
  });

  it("keeps case order, caps concurrency, and records errors", async () => {
    let active = 0;
    let peak = 0;
    const harness: Harness = {
      name: "t",
      runCase: async (input) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((done) => setTimeout(done, Number(input)));
        active -= 1;
        if (input === 3) {
          throw new Error("three\nfailed");
        }
        return { value: Number(input) };
      },
    };
    const cases = [5, 1, 3, 2, 4].map((input, index) => ({ id: `c${index}`, input }));
    const rows = await runCases(cases, harness, options({ concurrency: 2 }));
    expect(peak).toBe(2);
    expect(rows.map((row) => row.caseId)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    expect(rows[2]).toMatchObject({ status: "error", error: "three failed", fields: {} });
    expect(rows[4]).toMatchObject({ status: "ok", fields: { value: 4 } });
  });

  it("times out slow cases and aborts their signal", async () => {
    let aborted = false;
    const harness: Harness = {
      name: "slow",
      runCase: (_input, ctx) =>
        new Promise((done) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            done({ late: true });
          });
        }),
    };
    const rows = await runCases([{ id: "a", input: null }], harness, options({ timeoutMs: 20 }));
    expect(rows[0]).toMatchObject({ status: "timeout", error: "timed out after 20 ms" });
    expect(aborted).toBe(true);
  });

  it("turns image-like output into an error without keeping it", async () => {
    const harness: Harness = { name: "leaky", runCase: async () => ({ frame: "data:image/jpeg;base64,/9j/4AAQ" }) };
    const rows = await runCases([{ id: "a", input: null }], harness, options());
    expect(rows[0]?.status).toBe("error");
    expect(resultsCsv(rows)).not.toContain("/9j/4AAQ");
  });
});

describe("report", () => {
  const info: RunInfo = {
    suite: "Fit Bench!",
    harness: "fit",
    casesFile: "eval/cases/fit.json",
    gitSha: "abc1234",
    nodeVersion: "24.0.0",
    startedAt: new Date("2026-10-28T09:05:07.123Z"),
    finishedAt: new Date("2026-10-28T09:05:19.000Z"),
    concurrency: 2,
    timeoutMs: 60_000,
  };
  const rows: CaseRow[] = [
    { caseId: "a", status: "ok", ms: 10, error: null, fields: { score: 1 } },
    { caseId: "b", status: "timeout", ms: 30, error: "timed out", fields: {} },
  ];

  it("names run folders from the suite and UTC time", () => {
    expect(runFolderName(info.suite, info.startedAt)).toBe("fit-bench-20261028-090507");
    expect(runFolderName("!!!", info.startedAt)).toBe("eval-20261028-090507");
  });

  it("summarizes counts, failures, and the harness metrics", () => {
    const harness: Harness = { name: "fit", runCase: async () => ({}), summarize: () => "mean score 1.0" };
    const markdown = summaryMarkdown(info, rows, harness);
    expect(markdown).toContain("1 ok, 0 error, 1 timeout");
    expect(markdown).toContain("median case 20 ms");
    expect(markdown).toContain("mean score 1.0");
    expect(markdown).toContain("- `b` (timeout): timed out");
    const broken: Harness = { ...harness, summarize: () => { throw new Error("bad math"); } };
    expect(summaryMarkdown(info, rows, broken)).toContain("`summarize` failed: bad math");
  });
});

describe("cli", () => {
  let out: string | null = null;

  afterEach(async () => {
    if (out !== null) {
      await rm(out, { recursive: true, force: true });
      out = null;
    }
  });

  it("runs a harness and writes csv, summary, and metadata", async () => {
    out = await mkdtemp(join(tmpdir(), "look-eval-"));
    const lines: string[] = [];
    const code = await runEval(
      ["--harness", "test/fixtures/echo-harness.ts", "--cases", "test/fixtures/cases.json", "--out", out],
      {
        cwd: resolve(import.meta.dirname, ".."),
        now: () => new Date("2026-10-28T10:00:00Z"),
        clock: fakeClock(),
        gitSha: async () => "abc1234",
        write: (line) => lines.push(line),
        signal: new AbortController().signal,
      },
    );
    expect(code).toBe(0);
    expect(lines[0]).toContain("2/3 cases ok");
    const [folder] = await readdir(out);
    expect(folder).toBe("echo-20261028-100000");
    const csv = await readFile(join(out, folder ?? "", "results.csv"), "utf8");
    expect(csv.split("\r\n")[0]).toBe("caseId,status,ms,error,label,length");
    expect(csv).toContain('c,ok,5,,"x,y ""q""",7');
    expect(csv).toContain("b,error,5,harness exploded,,");
    expect(await readFile(join(out, folder ?? "", "summary.md"), "utf8")).toContain("ok rows: 2");
    expect(JSON.parse(await readFile(join(out, folder ?? "", "run.json"), "utf8"))).toMatchObject({ caseCount: 3, gitSha: "abc1234" });
  });

  it("reports setup errors with exit code 1", async () => {
    const lines: string[] = [];
    const deps = {
      cwd: resolve(import.meta.dirname, ".."),
      now: () => new Date(),
      clock: fakeClock(),
      gitSha: async () => null,
      write: (line: string) => lines.push(line),
      signal: new AbortController().signal,
    };
    expect(await runEval(["--harness", "x.ts"], deps)).toBe(1);
    expect(await runEval(["--harness", "test/fixtures/echo-harness.ts", "--cases", "missing.json"], deps)).toBe(1);
    expect(await runEval(["--harness", "test/fixtures/cases.json", "--cases", "test/fixtures/cases.json"], deps)).toBe(1);
    expect(lines.join("\n")).toContain("--harness and --cases are required");
  });
});
