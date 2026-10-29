import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { USAGE, parseEvalArgs } from "./lib/args.ts";
import { parseCases } from "./lib/cases.ts";
import { resultsCsv, runFolderName, runMetadata, summaryMarkdown } from "./lib/report.ts";
import { checkHarness, errorText, runCases } from "./lib/runner.ts";

export interface EvalDeps {
  cwd: string;
  now: () => Date;
  clock: () => number;
  gitSha: () => Promise<string | null>;
  write: (line: string) => void;
  signal: AbortSignal;
}

function readGitSha(cwd: string): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", ["rev-parse", "--short", "HEAD"], { cwd, timeout: 5_000 }, (error, stdout) => {
      done(error === null ? stdout.trim() || null : null);
    });
  });
}

async function createRunFolder(base: string, name: string): Promise<string> {
  await mkdir(base, { recursive: true });
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const folder = join(base, attempt === 1 ? name : `${name}-${attempt}`);
    try {
      await mkdir(folder);
      return folder;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
  }
  throw new Error(`could not create a run folder under ${base}`);
}

export async function runEval(argv: string[], deps: EvalDeps): Promise<number> {
  const args = parseEvalArgs(argv);
  if (!args.ok) {
    deps.write(`eval: ${args.error}\n${USAGE}`);
    return 1;
  }
  const { options } = args;
  const casesPath = resolve(deps.cwd, options.cases);
  let casesText: string;
  try {
    casesText = await readFile(casesPath, "utf8");
  } catch (error) {
    deps.write(`eval: could not read cases file: ${errorText(error)}`);
    return 1;
  }
  const cases = parseCases(casesText);
  if (!cases.ok) {
    deps.write(`eval: ${cases.error}`);
    return 1;
  }
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(resolve(deps.cwd, options.harness)).href);
  } catch (error) {
    deps.write(`eval: could not load harness: ${errorText(error)}`);
    return 1;
  }
  const checked = checkHarness(loaded);
  if (!checked.ok) {
    deps.write(`eval: ${checked.error}`);
    return 1;
  }
  const { harness } = checked;
  const startedAt = deps.now();
  const rows = await runCases(cases.cases, harness, {
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    now: deps.clock,
    signal: deps.signal,
  });
  const suite = options.suite ?? harness.name;
  const info = {
    suite,
    harness: harness.name,
    casesFile: relative(deps.cwd, casesPath),
    gitSha: await deps.gitSha(),
    nodeVersion: process.versions.node,
    startedAt,
    finishedAt: deps.now(),
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
  };
  const folder = await createRunFolder(resolve(deps.cwd, options.out), runFolderName(suite, startedAt));
  await writeFile(join(folder, "results.csv"), resultsCsv(rows));
  await writeFile(join(folder, "summary.md"), summaryMarkdown(info, rows, harness));
  await writeFile(join(folder, "run.json"), runMetadata(info, rows));
  const ok = rows.filter((row) => row.status === "ok").length;
  deps.write(`eval: ${ok}/${rows.length} cases ok; results in ${relative(deps.cwd, folder)}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const cwd = process.cwd();
  runEval(process.argv.slice(2), {
    cwd,
    now: () => new Date(),
    clock: () => performance.now(),
    gitSha: () => readGitSha(cwd),
    write: (line) => process.stdout.write(`${line}\n`),
    signal: controller.signal,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`eval: ${errorText(error)}\n`);
      process.exitCode = 1;
    },
  );
}
