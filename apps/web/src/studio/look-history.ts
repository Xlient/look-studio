import type { LookSpec } from "@look-studio/shared";

export const MAX_HISTORY = 30;

export interface LookHistory {
  past: (LookSpec | null)[];
  future: (LookSpec | null)[];
}

export interface HistoryStep {
  history: LookHistory;
  look: LookSpec | null;
}

export const EMPTY_HISTORY: LookHistory = { past: [], future: [] };

export function recordLook(history: LookHistory, previous: LookSpec | null): LookHistory {
  return { past: [...history.past, previous].slice(-MAX_HISTORY), future: [] };
}

export function undoLook(history: LookHistory, current: LookSpec | null): HistoryStep | null {
  if (history.past.length === 0) {
    return null;
  }
  const look = history.past[history.past.length - 1] ?? null;
  return { look, history: { past: history.past.slice(0, -1), future: [current, ...history.future] } };
}

export function redoLook(history: LookHistory, current: LookSpec | null): HistoryStep | null {
  if (history.future.length === 0) {
    return null;
  }
  const look = history.future[0] ?? null;
  return { look, history: { past: [...history.past, current].slice(-MAX_HISTORY), future: history.future.slice(1) } };
}
