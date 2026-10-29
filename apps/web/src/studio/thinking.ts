import type { CallKind, MonitorEntry } from "./studio-state.ts";

const RECENT_CALLS = 5;
const SLOW_FACTOR = 2;

export interface ThinkingStatus {
  title: string;
  elapsed: string;
  hint: string;
}

export function typicalLatencyMs(entries: readonly MonitorEntry[], call: CallKind): number | null {
  const recent = entries
    .filter((entry) => entry.ok && entry.call === call && entry.latencyMs > 0)
    .slice(0, RECENT_CALLS)
    .map((entry) => entry.latencyMs)
    .sort((a, b) => a - b);
  if (recent.length === 0) {
    return null;
  }
  const middle = Math.floor(recent.length / 2);
  const median = recent.length % 2 === 1 ? recent[middle] : ((recent[middle - 1] ?? 0) + (recent[middle] ?? 0)) / 2;
  return median ?? null;
}

export function thinkingTitle(call: CallKind): string {
  return call === "look" ? "LookArtist is designing your look" : "LookArtist is updating your look";
}

export function thinkingStatus(call: CallKind, elapsedMs: number, typicalMs: number | null): ThinkingStatus {
  const title = thinkingTitle(call);
  const elapsed = `${Math.max(0, Math.floor(elapsedMs / 1000))}s`;
  if (typicalMs === null) {
    return { title, elapsed, hint: "" };
  }
  const hint =
    elapsedMs > typicalMs * SLOW_FACTOR
      ? "Taking longer than usual"
      : `Usually about ${Math.max(1, Math.round(typicalMs / 1000))}s`;
  return { title, elapsed, hint };
}
