export const name = "echo";

export async function runCase(input: unknown): Promise<Record<string, number | string | boolean | null>> {
  if (input === "boom") {
    throw new Error("harness exploded");
  }
  return { label: String(input), length: String(input).length };
}

export function summarize(rows: { status: string }[]): string {
  return `ok rows: ${rows.filter((row) => row.status === "ok").length}`;
}
