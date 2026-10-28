import type { EditCommand, LookSpec } from "@look-studio/shared";
import type { CallMeta } from "./api-client.ts";
import { applyEdit, describeEdit } from "./look-edits.ts";
import { EMPTY_HISTORY, recordLook, redoLook, undoLook } from "./look-history.ts";
import type { HistoryStep, LookHistory } from "./look-history.ts";

export const MAX_MONITOR_ENTRIES = 50;
export const OFFLINE_MODEL = "offline-fake";

export type Sender = "artist" | "you" | "system";
export type CallKind = "look" | "edit";

export interface ChatMessage {
  id: number;
  from: Sender;
  at: string;
  text: string;
  look?: LookSpec;
  attachment?: string;
  note?: string;
}

export interface MonitorEntry {
  id: number;
  at: string;
  call: CallKind;
  model: string;
  ok: boolean;
  latencyMs: number;
  tokens: number;
  requestId: string | null;
  error?: string;
}

export interface StudioState {
  messages: ChatMessage[];
  monitor: MonitorEntry[];
  look: LookSpec | null;
  history: LookHistory;
  pending: boolean;
  streaming: string;
  nextId: number;
}

export type StudioAction =
  | { type: "sent"; at: string; text: string; attachment?: string; note?: string }
  | { type: "streamed"; text: string }
  | { type: "look-received"; at: string; look: LookSpec; meta: CallMeta }
  | { type: "edit-received"; at: string; command: EditCommand; meta: CallMeta }
  | { type: "failed"; at: string; call: CallKind; error: string; message: string }
  | { type: "reset"; at: string }
  | { type: "undo"; at: string }
  | { type: "redo"; at: string };

export const GREETING =
  "hey!! i'm LookArtist :) tell me the vibe you want, or attach a photo and i'll match its colours and style.";

export function initialStudioState(at: string): StudioState {
  return {
    messages: [{ id: 1, from: "artist", at, text: GREETING }],
    monitor: [],
    look: null,
    history: EMPTY_HISTORY,
    pending: false,
    streaming: "",
    nextId: 2,
  };
}

function monitorEntry(id: number, at: string, call: CallKind, meta: CallMeta): MonitorEntry {
  return {
    id,
    at,
    call,
    model: meta.model,
    ok: true,
    latencyMs: meta.latencyMs,
    tokens: meta.tokens.total,
    requestId: meta.requestId,
  };
}

function pushMonitor(monitor: MonitorEntry[], entry: MonitorEntry): MonitorEntry[] {
  return [entry, ...monitor].slice(0, MAX_MONITOR_ENTRIES);
}

function stepTo(state: StudioState, step: HistoryStep | null, at: string, verb: string): StudioState {
  if (step === null || state.pending) {
    return state;
  }
  const text = step.look === null ? `${verb}: back to the plain camera.` : `${verb}: back to ${step.look.name}.`;
  return {
    ...state,
    look: step.look,
    history: step.history,
    nextId: state.nextId + 1,
    messages: [...state.messages, { id: state.nextId, from: "system", at, text }],
  };
}

export function canUndo(state: StudioState): boolean {
  return !state.pending && state.history.past.length > 0;
}

export function canRedo(state: StudioState): boolean {
  return !state.pending && state.history.future.length > 0;
}

export function nextCall(state: StudioState, hasPhoto: boolean): CallKind {
  return state.look === null || hasPhoto ? "look" : "edit";
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  const id = state.nextId;
  switch (action.type) {
    case "sent":
      return {
        ...state,
        pending: true,
        streaming: "",
        nextId: id + 1,
        messages: [
          ...state.messages,
          {
            id,
            from: "you",
            at: action.at,
            text: action.text,
            ...(action.attachment ? { attachment: action.attachment } : {}),
            ...(action.note ? { note: action.note } : {}),
          },
        ],
      };
    case "streamed":
      return state.pending ? { ...state, streaming: state.streaming + action.text } : state;
    case "look-received":
      return {
        ...state,
        pending: false,
        streaming: "",
        look: action.look,
        history: recordLook(state.history, state.look),
        nextId: id + 2,
        messages: [
          ...state.messages,
          { id, from: "artist", at: action.at, text: action.look.description ?? "here's your look!", look: action.look },
        ],
        monitor: pushMonitor(state.monitor, monitorEntry(id + 1, action.at, "look", action.meta)),
      };
    case "edit-received": {
      if (state.look === null) {
        return { ...state, pending: false };
      }
      const look = applyEdit(state.look, action.command);
      return {
        ...state,
        pending: false,
        look,
        history: recordLook(state.history, state.look),
        nextId: id + 2,
        messages: [
          ...state.messages,
          { id, from: "artist", at: action.at, text: describeEdit(state.look, action.command), look },
        ],
        monitor: pushMonitor(state.monitor, monitorEntry(id + 1, action.at, "edit", action.meta)),
      };
    }
    case "reset":
      if (state.look === null) {
        return state;
      }
      return {
        ...state,
        look: null,
        history: recordLook(state.history, state.look),
        nextId: id + 1,
        messages: [...state.messages, { id, from: "system", at: action.at, text: "Starting a fresh look." }],
      };
    case "undo":
      return stepTo(state, undoLook(state.history, state.look), action.at, "Undo");
    case "redo":
      return stepTo(state, redoLook(state.history, state.look), action.at, "Redo");
    case "failed":
      return {
        ...state,
        pending: false,
        streaming: "",
        nextId: id + 2,
        messages: [...state.messages, { id, from: "system", at: action.at, text: action.message }],
        monitor: pushMonitor(state.monitor, {
          id: id + 1,
          at: action.at,
          call: action.call,
          model: "—",
          ok: false,
          latencyMs: 0,
          tokens: 0,
          requestId: null,
          error: action.error,
        }),
      };
  }
}

export interface MonitorSummary {
  calls: number;
  failures: number;
  avgLatencyMs: number;
  totalTokens: number;
  live: boolean;
}

export function summarizeMonitor(entries: MonitorEntry[]): MonitorSummary {
  const succeeded = entries.filter((entry) => entry.ok);
  const latency = succeeded.reduce((sum, entry) => sum + entry.latencyMs, 0);
  return {
    calls: entries.length,
    failures: entries.length - succeeded.length,
    avgLatencyMs: succeeded.length === 0 ? 0 : Math.round(latency / succeeded.length),
    totalTokens: succeeded.reduce((sum, entry) => sum + entry.tokens, 0),
    live: succeeded.some((entry) => entry.model !== OFFLINE_MODEL),
  };
}
