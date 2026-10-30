import type { EditCommand, LookSpec, Makeup, WearableSpec } from "@look-studio/shared";
import { applyEdit, describeEdit } from "./look-edits.ts";

export const MAX_HISTORY = 30;

type Restore =
  | { kind: "remove-at"; index: number }
  | { kind: "insert-at"; index: number; wearable: WearableSpec }
  | { kind: "replace-at"; index: number; wearable: WearableSpec }
  | { kind: "makeup"; makeup: Makeup | undefined };

interface EditStep {
  command: EditCommand;
  restore: Restore;
}

export type HistoryEntry =
  | { kind: "edit"; steps: EditStep[] }
  | { kind: "replace"; before: LookSpec | null; after: LookSpec | null };

export interface EditHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface HistoryStep {
  history: EditHistory;
  look: LookSpec | null;
}

export interface CommittedEdits extends HistoryStep {
  look: LookSpec;
  summary: string[];
}

export const EMPTY_HISTORY: EditHistory = { past: [], future: [] };

function push(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...entries, entry].slice(-MAX_HISTORY);
}

function captureRestore(look: LookSpec, command: EditCommand): Restore | null {
  if (command.op === "makeup") {
    return { kind: "makeup", makeup: look.makeup };
  }
  if (command.op === "add") {
    return { kind: "remove-at", index: look.wearables.length };
  }
  const index = look.wearables.findIndex((wearable) => wearable.id === command.targetId);
  const wearable = look.wearables[index];
  if (wearable === undefined) {
    return null;
  }
  return command.op === "remove" ? { kind: "insert-at", index, wearable } : { kind: "replace-at", index, wearable };
}

function applyRestore(look: LookSpec, restore: Restore): LookSpec {
  const wearables = look.wearables;
  switch (restore.kind) {
    case "remove-at":
      return { ...look, wearables: wearables.filter((_wearable, index) => index !== restore.index) };
    case "insert-at":
      return { ...look, wearables: [...wearables.slice(0, restore.index), restore.wearable, ...wearables.slice(restore.index)] };
    case "replace-at":
      return { ...look, wearables: wearables.map((wearable, index) => (index === restore.index ? restore.wearable : wearable)) };
    case "makeup": {
      if (restore.makeup !== undefined) {
        return { ...look, makeup: restore.makeup };
      }
      const copy = { ...look };
      delete copy.makeup;
      return copy;
    }
  }
}

function sameLook(a: LookSpec, b: LookSpec): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function commitEdits(history: EditHistory, look: LookSpec, commands: EditCommand[]): CommittedEdits | null {
  const steps: EditStep[] = [];
  const summary: string[] = [];
  let current = look;
  for (const command of commands) {
    const restore = captureRestore(current, command);
    const next = applyEdit(current, command);
    if (restore !== null && !sameLook(current, next)) {
      steps.push({ command, restore });
      summary.push(describeEdit(current, command));
      current = next;
    }
  }
  return steps.length === 0
    ? null
    : { look: current, summary, history: { past: push(history.past, { kind: "edit", steps }), future: [] } };
}

export function commitReplace(history: EditHistory, before: LookSpec | null, after: LookSpec | null): EditHistory {
  return { past: push(history.past, { kind: "replace", before, after }), future: [] };
}

export function undoStep(history: EditHistory, current: LookSpec | null): HistoryStep | null {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) {
    return null;
  }
  const look =
    entry.kind === "replace"
      ? entry.before
      : current === null
        ? null
        : entry.steps.reduceRight((restored, step) => applyRestore(restored, step.restore), current);
  return { look, history: { past: history.past.slice(0, -1), future: [entry, ...history.future] } };
}

export function redoStep(history: EditHistory, current: LookSpec | null): HistoryStep | null {
  const entry = history.future[0];
  if (entry === undefined) {
    return null;
  }
  const look =
    entry.kind === "replace"
      ? entry.after
      : current === null
        ? null
        : entry.steps.reduce((applied, step) => applyEdit(applied, step.command), current);
  return { look, history: { past: push(history.past, entry), future: history.future.slice(1) } };
}
