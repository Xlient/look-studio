import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EditBatch } from "../../packages/shared/src/index.ts";
import { asksToChangeSkinTone } from "../../apps/server/src/lib/skin-tone-guard.ts";
import { createEditCase } from "../harness/edit.ts";
import { EDIT_LOOKS } from "../harness/edit-looks.ts";
import { colorFamily, parseEditCase, satisfies, scoreCase, summarizeEdits } from "../harness/edit-scoring.ts";
import type { EditCaseInput as CaseInput, SummaryRow } from "../harness/edit-scoring.ts";
import { parseCases } from "../lib/cases.ts";
import { bootstrapMeanCi, mean, percentile, seededRandom } from "../lib/stats.ts";

const look = EDIT_LOOKS["crown-glam"];
const batch = (...commands: EditBatch["commands"]): EditBatch => ({ commands, skipped: 0 });
const signal = new AbortController().signal;

describe("stats", () => {
  it("computes means and interpolated percentiles", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([5], 0.95)).toBe(5);
  });

  it("gives a repeatable bootstrap interval that contains the mean", () => {
    const values = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
    const first = bootstrapMeanCi(values, seededRandom(7));
    expect(first).toEqual(bootstrapMeanCi(values, seededRandom(7)));
    expect(first?.low).toBeLessThanOrEqual(0.7);
    expect(first?.high).toBeGreaterThanOrEqual(0.7);
    expect(bootstrapMeanCi([1, 1, 1], seededRandom(1))).toEqual({ low: 1, high: 1 });
    expect(bootstrapMeanCi([], seededRandom(1))).toBeNull();
  });
});

describe("edit scoring", () => {
  it("names colour families", () => {
    expect(["#D32F2F", "#FF8DA1", "#FF7F50", "#6B4423", "#D4AF37", "#2E7D32", "#1E88E5", "#7B1FA2", "#111111", "#FAFAFA", "#9E9E9E"].map(colorFamily)).toEqual([
      "red", "pink", "orange", "brown", "yellow", "green", "blue", "purple", "black", "white", "grey",
    ]);
  });

  it("checks direction against the current look", () => {
    expect(satisfies({ op: "makeup", target: "lips", shade: "lighter" }, { op: "makeup", targetId: "lips", color: "#E57399" }, look)).toBe(true);
    expect(satisfies({ op: "makeup", target: "lips", shade: "lighter" }, { op: "makeup", targetId: "lips", color: "#5A0A2B" }, look)).toBe(false);
    expect(satisfies({ op: "makeup", target: "blush", opacity: "lower" }, { op: "makeup", targetId: "blush", opacity: 0.1 }, look)).toBe(true);
    expect(satisfies({ op: "makeup", target: "blush", opacity: "zero" }, { op: "makeup", targetId: "blush", opacity: 0.1 }, look)).toBe(false);
    expect(satisfies({ op: "move", target: "w-crown", move: "up" }, { op: "move", targetId: "w-crown", delta: { x: 0, y: 0.1, z: 0 } }, look)).toBe(true);
    expect(satisfies({ op: "move", target: "w-crown", move: "up" }, { op: "move", targetId: "w-glasses", delta: { x: 0, y: 0.1, z: 0 } }, look)).toBe(false);
    expect(satisfies({ op: "scale", target: "w-crown", factor: "smaller" }, { op: "scale", targetId: "w-crown", factor: 1.2 }, look)).toBe(false);
  });

  it("needs every expected command and no extras for an exact match", () => {
    const input: CaseInput = {
      look: "crown-glam",
      utterance: "redder lips and smaller crown",
      expect: [
        { op: "makeup", target: "lips", family: ["red"] },
        { op: "scale", target: "w-crown", factor: "smaller" },
      ],
    };
    const lips = { op: "makeup", targetId: "lips", color: "#D32F2F" } as const;
    const crown = { op: "scale", targetId: "w-crown", factor: 0.8 } as const;
    expect(scoreCase(input, { kind: "edits", batch: batch(crown, lips) })).toMatchObject({ exact: true, matched: 2, extra: 0 });
    expect(scoreCase(input, { kind: "edits", batch: batch(lips) })).toMatchObject({ exact: false, matched: 1, extra: 0 });
    expect(scoreCase(input, { kind: "edits", batch: batch(lips, crown, { op: "remove", targetId: "w-glasses" }) })).toMatchObject({ exact: false, extra: 1 });
    expect(scoreCase(input, { kind: "unresolved" })).toMatchObject({ pass: false, got: "unresolved" });
  });

  it("passes ambiguity and refusal cases only on the matching outcome", () => {
    const ambiguous: CaseInput = { look: "two-hats", utterance: "remove the hat", expect: "unresolved" };
    expect(scoreCase(ambiguous, { kind: "unresolved" })).toMatchObject({ pass: true });
    expect(scoreCase(ambiguous, { kind: "edits", batch: batch({ op: "remove", targetId: "w-cap" }) })).toMatchObject({ pass: false });
  });
});

describe("edit harness", () => {
  it("scores a model answer and charges its cost, without calling the model for refusals", async () => {
    let calls = 0;
    const runCase = createEditCase(async (_utterance, _look, budget) => {
      calls += 1;
      budget.record(0.002);
      return batch({ op: "remove", targetId: "w-glasses" });
    });
    const removed = await runCase({ look: "crown-glam", utterance: "take off the glasses", expect: [{ op: "remove", target: "w-glasses" }] }, { signal });
    expect(removed).toMatchObject({ pass: true, costUsd: 0.002 });
    const refused = await runCase({ look: "crown-glam", utterance: "make my skin darker", expect: "refused" }, { signal });
    expect(refused).toMatchObject({ pass: true, got: "refused", costUsd: 0 });
    expect(calls).toBe(1);
    const unresolved = await createEditCase(async () => null)({ look: "two-hats", utterance: "remove the hat", expect: "unresolved" }, { signal });
    expect(unresolved).toMatchObject({ pass: true });
  });

  it("rejects a malformed case and passes model errors through", async () => {
    const runCase = createEditCase(async () => {
      throw new Error("model down");
    });
    await expect(runCase({ look: "nowhere", utterance: "x", expect: "unresolved" }, { signal })).rejects.toThrow();
    await expect(runCase({ look: "bare", utterance: "add a hat", expect: [{ op: "add", target: "new" }] }, { signal })).rejects.toThrow("model down");
  });

  it("summarizes rates, intervals, latency, and cost", () => {
    const rows: SummaryRow[] = [
      { status: "ok", ms: 800, fields: { wanted: "edits", got: "edits", pass: true, exact: true, expected: 1, matched: 1, extra: 0, costUsd: 0.001 } },
      { status: "ok", ms: 1200, fields: { wanted: "edits", got: "edits", pass: false, exact: false, expected: 2, matched: 1, extra: 1, costUsd: 0.003 } },
      { status: "ok", ms: 3, fields: { wanted: "refused", got: "refused", pass: true, costUsd: 0 } },
      { status: "error", ms: 50, fields: {} },
    ];
    const summary = summarizeEdits(rows);
    expect(summary).toContain("| Exact match (2 edit cases) | 50.0% |");
    expect(summary).toContain("| Command recall | 66.7% |");
    expect(summary).toContain("| Command precision | 66.7% |");
    expect(summary).toContain("1000 ms / 1180 ms");
    expect(summary).toContain("$0.00200 / $0.0040");
  });
});

describe("edit cases file", () => {
  const parsed = parseCases(readFileSync(new URL("../cases/edit.json", import.meta.url), "utf8"));
  const cases = parsed.ok ? parsed.cases : [];

  it("has 100 valid cases", () => {
    expect(parsed.ok).toBe(true);
    expect(cases).toHaveLength(100);
    for (const item of cases) {
      expect(() => parseEditCase(item.input), item.id).not.toThrow();
    }
  });

  it("labels as refused exactly the utterances the skin tone guard refuses", () => {
    for (const item of cases) {
      const input = parseEditCase(item.input);
      expect(asksToChangeSkinTone(input.utterance), `${item.id}: ${input.utterance}`).toBe(input.expect === "refused");
    }
  });

  it("points every non-add expectation at something in its look", () => {
    for (const item of cases) {
      const input = parseEditCase(item.input);
      const targets = new Set([...EDIT_LOOKS[input.look].wearables.map((w) => w.id), "lips", "blush", "eyeshadow", "brows"]);
      for (const expected of Array.isArray(input.expect) ? input.expect : []) {
        expect(expected.op === "add" || targets.has(expected.target), `${item.id} -> ${expected.target}`).toBe(true);
      }
    }
  });
});
