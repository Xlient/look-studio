# eval

A small, dependency-free runner for Look Studio evals. You write a harness and a
cases file; the runner runs every case and writes the results. It contains no
metrics of its own.

```bash
pnpm eval --harness eval/harness/fit.ts --cases eval/cases/fit.json
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--harness` | required | Module that exports the harness (below) |
| `--cases` | required | JSON array of `{ "id": string, "input": any }` with unique ids |
| `--suite` | harness `name` | Name used for the run folder |
| `--concurrency` | 1 | Cases in flight at once, 1 to 8. Keep it low for model calls. |
| `--timeout-ms` | 60000 | Per-case limit; the case's `signal` is aborted when it passes |
| `--out` | `eval/results` | Where run folders go (ignored by git) |

## Harness contract

```ts
export const name = "fit";

export async function runCase(
  input: unknown,
  ctx: { caseId: string; signal: AbortSignal },
): Promise<Record<string, number | string | boolean | null>> {
  // Call the app or the model here and return flat scalar fields.
}

// Optional: markdown for the summary, such as means and bootstrap intervals.
export function summarize(rows: { caseId: string; status: "ok" | "error" | "timeout"; ms: number; error: string | null; fields: Record<string, number | string | boolean | null> }[]): string {
  return "";
}
```

Field names must match `[A-Za-z][A-Za-z0-9_.-]*` and must not be `caseId`,
`status`, `ms`, or `error`. A case whose fields are not flat scalars, are longer
than 500 characters, or look like image data (`data:` URLs or long base64) is
recorded as an error and its output is dropped. Case inputs are never written
to disk, so images used as inputs stay out of the results.

## Output

Each run writes `eval/results/<suite>-<UTC time>/`:

- `results.csv`: one row per case with `caseId`, `status`, `ms`, `error`, then your fields in sorted order.
- `summary.md`: counts, wall time, median case time, your `summarize` output, and failed cases.
- `run.json`: harness, cases file, git commit, Node version, settings, and times.

The command exits 0 when the run completes, even if cases failed, and 1 for setup
errors such as a missing file or a harness without `name` and `runCase`.
