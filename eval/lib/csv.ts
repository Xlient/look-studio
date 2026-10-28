export type Cell = string | number | boolean | null;

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  // Spreadsheets run cells that start with = + - @ as formulas.
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function columnsFor(fixed: string[], rows: Record<string, Cell>[]): string[] {
  const extra = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fixed.includes(key)) {
        extra.add(key);
      }
    }
  }
  return [...fixed, ...[...extra].sort()];
}

export function toCsv(columns: string[], rows: Record<string, Cell>[]): string {
  const lines = [columns.map(csvCell), ...rows.map((row) => columns.map((column) => csvCell(row[column] ?? null)))];
  return `${lines.map((line) => line.join(",")).join("\r\n")}\r\n`;
}
