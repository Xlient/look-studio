import { EditOp, MAX_EDITS, MakeupArea, WearableType } from "../../packages/shared/src/index.ts";
import type { EditBatch, EditCommand, LookSpec } from "../../packages/shared/src/index.ts";
import { EDIT_LOOKS, EDIT_LOOK_NAMES } from "./edit-looks.ts";
import type { EditLookName } from "./edit-looks.ts";
import { bootstrapMeanCi, mean, percentile, seededRandom } from "../lib/stats.ts";
import type { Interval } from "../lib/stats.ts";

export const COLOR_FAMILIES = ["red", "pink", "orange", "brown", "yellow", "green", "blue", "purple", "black", "white", "grey"] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

const SHADES = ["lighter", "darker"] as const;
const OPACITIES = ["lower", "higher", "zero"] as const;
const FACTORS = ["bigger", "smaller"] as const;
const MOVES = ["up", "down", "left", "right", "forward", "back"] as const;

export interface Expected {
  op: EditOp;
  target: string;
  family?: ColorFamily[];
  shade?: (typeof SHADES)[number];
  opacity?: (typeof OPACITIES)[number];
  factor?: (typeof FACTORS)[number];
  move?: (typeof MOVES)[number];
  types?: WearableType[];
}

export interface EditCaseInput {
  look: EditLookName;
  utterance: string;
  expect: Expected[] | "unresolved" | "refused";
}

class CaseError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(options: readonly T[], value: unknown, field: string): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const found = options.find((option) => option === value);
  if (found === undefined) {
    throw new CaseError(`${field} must be one of ${options.join(", ")}`);
  }
  return found;
}

function listOf<T extends string>(options: readonly T[], value: unknown, field: string): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CaseError(`${field} must be a non-empty list`);
  }
  return value.map((item) => oneOf(options, item, field) ?? options[0]);
}

const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

function parseExpected(value: unknown): Expected {
  if (!isRecord(value) || typeof value["target"] !== "string" || value["target"] === "") {
    throw new CaseError("each expectation needs an op and a target");
  }
  const op = EditOp.safeParse(value["op"]);
  if (!op.success) {
    throw new CaseError(`unknown op ${String(value["op"])}`);
  }
  return {
    op: op.data,
    target: value["target"],
    ...optional("family", listOf(COLOR_FAMILIES, value["family"], "family")),
    ...optional("shade", oneOf(SHADES, value["shade"], "shade")),
    ...optional("opacity", oneOf(OPACITIES, value["opacity"], "opacity")),
    ...optional("factor", oneOf(FACTORS, value["factor"], "factor")),
    ...optional("move", oneOf(MOVES, value["move"], "move")),
    ...optional("types", listOf(WearableType.options, value["types"], "types")),
  };
}

export function parseEditCase(value: unknown): EditCaseInput {
  if (!isRecord(value) || typeof value["utterance"] !== "string" || value["utterance"].trim() === "" || value["utterance"].length > 2_000) {
    throw new CaseError("a case needs a look and an utterance under 2,000 characters");
  }
  const look = oneOf(EDIT_LOOK_NAMES, value["look"], "look");
  const expect = value["expect"];
  if (look === undefined) {
    throw new CaseError("a case needs a look");
  }
  if (expect === "unresolved" || expect === "refused") {
    return { look, utterance: value["utterance"], expect };
  }
  if (!Array.isArray(expect) || expect.length === 0 || expect.length > MAX_EDITS) {
    throw new CaseError(`expect must be "unresolved", "refused", or 1 to ${MAX_EDITS} expectations`);
  }
  return { look, utterance: value["utterance"], expect: expect.map(parseExpected) };
}

export type EditOutcome = { kind: "edits"; batch: EditBatch } | { kind: "unresolved" } | { kind: "refused" };

function hsl(hex: string): { h: number; s: number; l: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return { h: 0, s: 0, l };
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function colorFamily(hex: string): ColorFamily {
  const { h, s, l } = hsl(hex);
  if (l < 0.12) {
    return "black";
  }
  if (s < 0.15) {
    return l > 0.85 ? "white" : "grey";
  }
  if (l > 0.92) {
    return "white";
  }
  if (h < 15 || h >= 345) {
    return l > 0.7 ? "pink" : "red";
  }
  if (h < 45) {
    return l < 0.4 || s < 0.45 ? "brown" : "orange";
  }
  if (h < 70) {
    return "yellow";
  }
  if (h < 170) {
    return "green";
  }
  if (h < 255) {
    return "blue";
  }
  return h < 290 ? "purple" : "pink";
}

export const lightness = (hex: string): number => hsl(hex).l;

function currentLayer(look: LookSpec, target: string): { color?: string; opacity?: number; scale?: number } {
  const area = MakeupArea.safeParse(target);
  if (area.success) {
    return look.makeup?.[area.data] ?? {};
  }
  const wearable = look.wearables.find((item) => item.id === target);
  return wearable === undefined ? {} : { ...(wearable.color === undefined ? {} : { color: wearable.color }), scale: wearable.scale ?? 1 };
}

const AXES = { up: ["y", 1], down: ["y", -1], right: ["x", 1], left: ["x", -1], forward: ["z", 1], back: ["z", -1] } as const;

export function satisfies(expected: Expected, command: EditCommand, look: LookSpec): boolean {
  if (command.op !== expected.op) {
    return false;
  }
  if (expected.op === "add") {
    return expected.types === undefined || (command.wearable !== undefined && expected.types.includes(command.wearable.type));
  }
  if (command.targetId !== expected.target) {
    return false;
  }
  const before = currentLayer(look, expected.target);
  if (expected.family !== undefined && (command.color === undefined || !expected.family.includes(colorFamily(command.color)))) {
    return false;
  }
  if (expected.shade !== undefined) {
    if (command.color === undefined || before.color === undefined) {
      return false;
    }
    const change = lightness(command.color) - lightness(before.color);
    if (expected.shade === "lighter" ? change <= 0 : change >= 0) {
      return false;
    }
  }
  if (expected.opacity !== undefined) {
    const next = command.opacity;
    const was = before.opacity ?? 0;
    const ok = next !== undefined && (expected.opacity === "zero" ? next === 0 : expected.opacity === "lower" ? next < was : next > was);
    if (!ok) {
      return false;
    }
  }
  if (expected.factor !== undefined && (command.factor === undefined || (expected.factor === "bigger" ? command.factor <= 1 : command.factor >= 1))) {
    return false;
  }
  if (expected.move !== undefined) {
    const [axis, sign] = AXES[expected.move];
    if (command.delta === undefined || command.delta[axis] * sign <= 0) {
      return false;
    }
  }
  return true;
}

export type ScoreFields = Record<string, number | string | boolean | null>;

export function scoreCase(input: EditCaseInput, outcome: EditOutcome): ScoreFields {
  const look: LookSpec = EDIT_LOOKS[input.look];
  const wanted = typeof input.expect === "string" ? input.expect : "edits";
  if (typeof input.expect === "string" || outcome.kind !== "edits") {
    return { wanted, got: outcome.kind, pass: wanted === outcome.kind, expected: 0, matched: 0, extra: 0, exact: wanted === outcome.kind };
  }
  const unused = [...outcome.batch.commands];
  let matched = 0;
  for (const expected of input.expect) {
    const index = unused.findIndex((command) => satisfies(expected, command, look));
    if (index >= 0) {
      unused.splice(index, 1);
      matched += 1;
    }
  }
  const exact = matched === input.expect.length && unused.length === 0;
  return { wanted, got: "edits", pass: exact, expected: input.expect.length, matched, extra: unused.length, exact };
}

export interface SummaryRow {
  status: string;
  ms: number;
  fields: ScoreFields;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ci = (interval: Interval | null) => (interval === null ? "n/a" : `${pct(interval.low)} to ${pct(interval.high)}`);

export function summarizeEdits(rows: readonly SummaryRow[], seed = 1): string {
  const random = seededRandom(seed);
  const scored = rows.filter((row) => row.status === "ok");
  const passes = scored.map((row) => (row.fields["pass"] === true ? 1 : 0));
  const editRows = scored.filter((row) => row.fields["wanted"] === "edits");
  const exact = editRows.map((row) => (row.fields["exact"] === true ? 1 : 0));
  const guardRows = scored.filter((row) => row.fields["wanted"] !== "edits");
  const matched = editRows.reduce((sum, row) => sum + num(row.fields["matched"]), 0);
  const expected = editRows.reduce((sum, row) => sum + num(row.fields["expected"]), 0);
  const extra = editRows.reduce((sum, row) => sum + num(row.fields["extra"]), 0);
  const modelRows = scored.filter((row) => row.fields["got"] !== "refused");
  const latency = modelRows.map((row) => row.ms);
  const costs = modelRows.map((row) => num(row.fields["costUsd"]));
  return [
    "| Metric | Value | 95% bootstrap CI |",
    "| --- | --- | --- |",
    `| Pass rate (all ${scored.length} scored cases) | ${pct(mean(passes))} | ${ci(bootstrapMeanCi(passes, random))} |`,
    `| Exact match (${editRows.length} edit cases) | ${pct(mean(exact))} | ${ci(bootstrapMeanCi(exact, random))} |`,
    `| Command recall | ${pct(expected === 0 ? null : matched / expected)} | |`,
    `| Command precision | ${pct(matched + extra === 0 ? null : matched / (matched + extra))} | |`,
    `| Refusal and ambiguity handling (${guardRows.length} cases) | ${pct(mean(guardRows.map((row) => (row.fields["pass"] === true ? 1 : 0))))} | |`,
    `| Latency p50 / p95 (${latency.length} model calls) | ${Math.round(percentile(latency, 0.5) ?? 0)} ms / ${Math.round(percentile(latency, 0.95) ?? 0)} ms | |`,
    `| Cost mean / total | $${(mean(costs) ?? 0).toFixed(5)} / $${costs.reduce((a, b) => a + b, 0).toFixed(4)} | |`,
  ].join("\n");
}
