import type { EditCommand, LookSpec, WearableSpec } from "@look-studio/shared";
import { applyEdit } from "./look-edits.ts";

export const MAX_HISTORY = 30;

type Restore =
  | { kind: "remove-at"; index: number }
  | { kind: "insert-at"; index: number; wearable: WearableSpec }
  | { kind: "replace-at"; index: number; wearable: WearableSpec }
  | { kind: "palette"; palette: string[] | undefined };

export type HistoryEntry =
  | { kind: "edit"; command: EditCommand; restore: Restore }
  | { kind: "replace"; before: LookSpec | null; after: LookSpec | null };

export interface EditHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface HistoryStep {
  history: EditHistory;
  look: LookSpec | null;
}

export const EMPTY_HISTORY: EditHistory = { past: [], future: [] };

function push(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...entries, entry].slice(-MAX_HISTORY);
}

function captureRestore(look: LookSpec, command: EditCommand): Restore | null {
  if (command.op === "recolor") {
    return { kind: "palette", palette: look.palette };
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
    case "palette": {
      if (restore.palette !== undefined) {
        return { ...look, palette: restore.palette };
      }
      const copy = { ...look };
      delete copy.palette;
      return copy;
    }
  }
}

function sameLook(a: LookSpec, b: LookSpec): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function runEdit(look: LookSpec, command: EditCommand): { look: LookSpec; entry: HistoryEntry } | null {
  const restore = captureRestore(look, command);
  const next = applyEdit(look, command);
  if (restore === null || sameLook(look, next)) {
    return null;
  }
  return { look: next, entry: { kind: "edit", command, restore } };
}

export function commitEdit(history: EditHistory, look: LookSpec, command: EditCommand): HistoryStep | null {
  const result = runEdit(look, command);
  return result === null ? null : { look: result.look, history: { past: push(history.past, result.entry), future: [] } };
}

export function commitReplace(history: EditHistory, before: LookSpec | null, after: LookSpec | null): EditHistory {
  return { past: push(history.past, { kind: "replace", before, after }), future: [] };
}

export function undoStep(history: EditHistory, current: LookSpec | null): HistoryStep | null {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) {
    return null;
  }
  const look = entry.kind === "replace" ? entry.before : current === null ? null : applyRestore(current, entry.restore);
  return { look, history: { past: history.past.slice(0, -1), future: [entry, ...history.future] } };
}

export function redoStep(history: EditHistory, current: LookSpec | null): HistoryStep | null {
  const entry = history.future[0];
  if (entry === undefined) {
    return null;
  }
  const look = entry.kind === "replace" ? entry.after : current === null ? null : applyEdit(current, entry.command);
  return { look, history: { past: push(history.past, entry), future: history.future.slice(1) } };
}
