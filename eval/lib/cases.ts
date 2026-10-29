export const MAX_CASES = 10_000;

export interface EvalCase {
  id: string;
  input: unknown;
}

export type CasesResult = { ok: true; cases: EvalCase[] } | { ok: false; error: string };

export function parseCases(text: string): CasesResult {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "cases file is not valid JSON" };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: "cases file must be a JSON array of { id, input }" };
  }
  if (data.length === 0 || data.length > MAX_CASES) {
    return { ok: false, error: `cases file must have between 1 and ${MAX_CASES} cases` };
  }
  const seen = new Set<string>();
  const cases: EvalCase[] = [];
  for (const [index, entry] of data.entries()) {
    if (typeof entry !== "object" || entry === null || !("id" in entry) || !("input" in entry)) {
      return { ok: false, error: `case ${index} needs an id and an input` };
    }
    const id = entry.id;
    if (typeof id !== "string" || id.trim() === "" || id.length > 100) {
      return { ok: false, error: `case ${index} has an empty or invalid id` };
    }
    if (seen.has(id)) {
      return { ok: false, error: `case id "${id}" appears more than once` };
    }
    seen.add(id);
    cases.push({ id, input: entry.input });
  }
  return { ok: true, cases };
}
