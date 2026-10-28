import { describe, expect, it } from "vitest";
import type { EditCommand, LookSpec, WearableSpec } from "@look-studio/shared";
import { EMPTY_HISTORY, MAX_HISTORY, commitEdit, commitReplace, redoStep, undoStep } from "../src/studio/edit-history.ts";
import type { EditHistory, HistoryStep } from "../src/studio/edit-history.ts";
import { MAX_OFFSET, SCALE_RANGE } from "../src/studio/look-edits.ts";

const crown: WearableSpec = { id: "w1", type: "hat", label: "Crown", anchor: { region: "head" } };
const shades: WearableSpec = { id: "w2", type: "glasses", label: "Shades", anchor: { region: "face" }, scale: 4 };
const chain: WearableSpec = { id: "w3", type: "necklace", label: "Chain", anchor: { region: "neck" }, visible: false };
const base: LookSpec = { id: "look-1", name: "Gold", style: "formal", wearables: [crown, shades, chain] };

function edit(look: LookSpec, command: EditCommand, history: EditHistory = EMPTY_HISTORY): HistoryStep {
  const step = commitEdit(history, look, command);
  if (step === null || step.look === null) {
    throw new Error(`edit ${command.op} changed nothing`);
  }
  return step;
}

function roundTrip(look: LookSpec, command: EditCommand): void {
  const done = edit(look, command);
  const undone = undoStep(done.history, done.look);
  expect(undone?.look).toEqual(look);
  const redone = undone === null ? null : redoStep(undone.history, undone.look);
  expect(redone?.look).toEqual(done.look);
}

describe("edit history round trips", () => {
  const commands: [string, EditCommand][] = [
    ["add", { op: "add", targetId: "w4", wearable: { id: "w4", type: "watch", label: "Watch", anchor: { region: "left-hand" } } }],
    ["remove from the middle", { op: "remove", targetId: "w2" }],
    ["toggle", { op: "toggle", targetId: "w3" }],
    ["move", { op: "move", targetId: "w1", delta: { x: 0.1, y: 0.3, z: 0 } }],
    ["scale", { op: "scale", targetId: "w1", factor: 1.5 }],
    ["recolor without a palette", { op: "recolor", targetId: "w1", color: "#FF0000" }],
  ];

  for (const [name, command] of commands) {
    it(`restores exactly after ${name}`, () => roundTrip(base, command));
  }

  it("restores a palette that existed", () => {
    roundTrip({ ...base, palette: ["#111111", "#FF0000"] }, { op: "recolor", targetId: "w1", color: "#FF0000" });
  });

  it("puts a removed wearable back at its index", () => {
    const done = edit(base, { op: "remove", targetId: "w2" });
    expect(undoStep(done.history, done.look)?.look?.wearables.map((wearable) => wearable.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("restores clamped scale and offset exactly", () => {
    const scaled = edit(base, { op: "scale", targetId: "w2", factor: 10 });
    expect(scaled.look?.wearables[1]?.scale).toBe(SCALE_RANGE.max);
    expect(undoStep(scaled.history, scaled.look)?.look?.wearables[1]?.scale).toBe(4);
    const moved = edit(base, { op: "move", targetId: "w1", delta: { x: 9, y: -9, z: 0.5 } });
    expect(moved.look?.wearables[0]?.anchor.offset).toEqual({ x: MAX_OFFSET, y: -MAX_OFFSET, z: 0.5 });
    expect(undoStep(moved.history, moved.look)?.look).toEqual(base);
  });

  it("records nothing for edits that change nothing", () => {
    expect(commitEdit(EMPTY_HISTORY, base, { op: "toggle", targetId: "missing" })).toBeNull();
    expect(commitEdit(EMPTY_HISTORY, base, { op: "move", targetId: "w1" })).toBeNull();
    const full: LookSpec = { ...base, wearables: Array.from({ length: 20 }, (_v, i) => ({ ...crown, id: `f${i}` })) };
    expect(commitEdit(EMPTY_HISTORY, full, { op: "add", targetId: "x", wearable: { ...crown, id: "x" } })).toBeNull();
    const atMax = edit(base, { op: "scale", targetId: "w2", factor: 10 });
    expect(atMax.look === null ? null : commitEdit(atMax.history, atMax.look, { op: "scale", targetId: "w2", factor: 2 })).toBeNull();
  });
});

describe("edit history stack", () => {
  it("mixes whole-look replacements with edits", () => {
    let history = commitReplace(EMPTY_HISTORY, null, base);
    const toggled = edit(base, { op: "toggle", targetId: "w1" }, history);
    history = commitReplace(toggled.history, toggled.look, null);
    let step = undoStep(history, null);
    expect(step?.look).toEqual(toggled.look);
    step = step === null ? null : undoStep(step.history, step.look);
    expect(step?.look).toEqual(base);
    step = step === null ? null : undoStep(step.history, step.look);
    expect(step?.look).toBeNull();
    expect(step === null ? "none" : undoStep(step.history, step.look)).toBeNull();
  });

  it("stays bounded and clears redo on a new change", () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
      history = commitReplace(history, null, { ...base, id: `look-${i}` });
    }
    expect(history.past).toHaveLength(MAX_HISTORY);
    const step = undoStep(history, base);
    expect(step?.history.future).toHaveLength(1);
    expect(step === null ? null : edit(base, { op: "toggle", targetId: "w1" }, step.history).history.future).toEqual([]);
    expect(redoStep(EMPTY_HISTORY, base)).toBeNull();
  });
});

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCommand(look: LookSpec, random: () => number, serial: number): EditCommand {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const target = look.wearables.length === 0 ? "none" : pick(look.wearables).id;
  const signed = () => (random() - 0.5) * 2;
  switch (pick(["add", "remove", "toggle", "move", "scale", "recolor"] as const)) {
    case "add":
      return { op: "add", targetId: `n${serial}`, wearable: { ...crown, id: `n${serial}`, label: `Item ${serial}` } };
    case "remove":
      return { op: "remove", targetId: target };
    case "toggle":
      return { op: "toggle", targetId: target };
    case "move":
      return { op: "move", targetId: target, delta: { x: signed(), y: signed(), z: signed() } };
    case "scale":
      return { op: "scale", targetId: target, factor: 0.2 + random() * 3 };
    case "recolor":
      return { op: "recolor", targetId: target, color: pick(["#FF0000", "#00FF00", "#0000FF", "#FFD700"]) };
  }
}

describe("edit history property", () => {
  it("undoes every edit back to the original look for many seeds", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = seeded(seed);
      let look: LookSpec | null = base;
      let history: EditHistory = EMPTY_HISTORY;
      const forward: LookSpec[] = [];
      for (let i = 0; history.past.length < MAX_HISTORY && i < 200; i += 1) {
        const step: HistoryStep | null = look === null ? null : commitEdit(history, look, randomCommand(look, random, i));
        if (step !== null) {
          history = step.history;
          look = step.look;
          forward.push(step.look ?? base);
        }
      }
      for (let step = undoStep(history, look); step !== null; step = undoStep(history, look)) {
        history = step.history;
        look = step.look;
      }
      expect(look).toEqual(base);
      for (const expected of forward) {
        const step = redoStep(history, look);
        expect(step?.look).toEqual(expected);
        history = step?.history ?? history;
        look = step?.look ?? null;
      }
    }
  });

  it("undoes 200 random edits back to the start and redoes them to the end", () => {
    const random = seeded(42);
    const states: LookSpec[] = [base];
    let current = base;
    let history: EditHistory = { past: [], future: [] };
    let committed = 0;
    for (let i = 0; i < 200; i += 1) {
      const step = commitEdit(history, current, randomCommand(current, random, i));
      if (step === null || step.look === null) {
        continue;
      }
      current = step.look;
      history = step.history;
      states.push(current);
      committed += 1;
    }
    expect(committed).toBeGreaterThan(MAX_HISTORY);
    const kept = states.slice(-(MAX_HISTORY + 1));
    let look: LookSpec | null = current;
    for (let i = kept.length - 2; i >= 0; i -= 1) {
      const step = undoStep(history, look);
      expect(step?.look).toEqual(kept[i]);
      history = step?.history ?? history;
      look = step?.look ?? null;
    }
    expect(undoStep(history, look)).toBeNull();
    for (let i = 1; i < kept.length; i += 1) {
      const step = redoStep(history, look);
      expect(step?.look).toEqual(kept[i]);
      history = step?.history ?? history;
      look = step?.look ?? null;
    }
  });
});
