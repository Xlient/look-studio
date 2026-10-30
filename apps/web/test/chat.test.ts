import { describe, expect, it } from "vitest";
import type { LookSpec, WearableSpec } from "@look-studio/shared";
import { createWearableJob, watchWearableJob } from "../src/studio/api-client.ts";
import type { CallMeta, FetchLike } from "../src/studio/api-client.ts";
import { clampVibe, composePrompt, contextNote, vibeLabel } from "../src/studio/prompt-compose.ts";
import { historyShortcut } from "../src/studio/shortcuts.ts";
import type { ShortcutEvent } from "../src/studio/shortcuts.ts";
import { createSseParser } from "../src/studio/sse.ts";
import type { SseEvent } from "../src/studio/sse.ts";
import { canRedo, canUndo, initialStudioState, studioReducer } from "../src/studio/studio-state.ts";
import type { JobStatus } from "../src/studio/wearable-jobs.ts";
import {
  applyJobStatus,
  failJob,
  finishFit,
  jobPhaseLabel,
  jobsToStart,
  parseJobStatus,
  startJob,
} from "../src/studio/wearable-jobs.ts";

const meta: CallMeta = {
  model: "muse-spark-1.3",
  latencyMs: 100,
  tokens: { input: 1, output: 1, total: 2 },
  requestId: null,
  attempts: 1,
};

const crown: WearableSpec = { id: "w1", type: "hat", label: "Crown", anchor: { region: "head" } };
const gold: LookSpec = { id: "look-1", name: "Gold", style: "formal", wearables: [crown] };
const signal = new AbortController().signal;

describe("sse parser", () => {
  it("handles split chunks, CRLF, multi-line data, and comments", () => {
    const events: SseEvent[] = [];
    const parse = createSseParser((event) => events.push(event));
    parse("event: delta\r\nda");
    parse('ta: {"text":"a"}\r\n\r\n: keepalive\n\n');
    parse("data: line one\ndata: line two\n\n");
    expect(events).toEqual([
      { event: "delta", data: '{"text":"a"}' },
      { event: "message", data: "line one\nline two" },
    ]);
  });
});

describe("studio undo and streaming", () => {
  it("undoes and redoes looks, edits, and resets", () => {
    let state = initialStudioState("9:00");
    expect(canUndo(state)).toBe(false);
    state = studioReducer(state, { type: "look-received", at: "9:01", look: gold, meta });
    state = studioReducer(state, { type: "edit-received", at: "9:02", edits: { commands: [{ op: "toggle", targetId: "w1" }], skipped: 0 }, meta });
    state = studioReducer(state, { type: "reset", at: "9:03" });
    expect(state.look).toBeNull();
    state = studioReducer(state, { type: "undo", at: "9:04" });
    expect(state.look?.wearables[0]?.visible).toBe(false);
    state = studioReducer(state, { type: "undo", at: "9:05" });
    expect(state.look).toEqual(gold);
    expect(canRedo(state)).toBe(true);
    state = studioReducer(state, { type: "redo", at: "9:06" });
    expect(state.look?.wearables[0]?.visible).toBe(false);
    expect(state.messages.at(-1)?.text).toBe("Redo: back to Gold.");
  });

  it("applies a whole revision as one undo step and says what it skipped", () => {
    let state = studioReducer(initialStudioState("9:00"), { type: "look-received", at: "9:01", look: gold, meta });
    state = studioReducer(state, {
      type: "edit-received",
      at: "9:02",
      edits: {
        commands: [
          { op: "makeup", targetId: "brows", color: "#8A7560", opacity: 0.4 },
          { op: "makeup", targetId: "lips", color: "#C76B6B", opacity: 0.45 },
        ],
        skipped: 1,
      },
      meta,
    });
    expect(state.look?.makeup?.brows?.color).toBe("#8A7560");
    expect(state.look?.makeup?.lips?.color).toBe("#C76B6B");
    expect(state.messages.at(-1)?.text).toBe("Changed brows to #8A7560. Changed lips to #C76B6B. I couldn't work out the rest of that request.");
    state = studioReducer(state, { type: "undo", at: "9:03" });
    expect(state.look).toEqual(gold);
  });

  it("ignores undo while a call is pending and a reset with no look", () => {
    let state = studioReducer(initialStudioState("9:00"), { type: "look-received", at: "9:01", look: gold, meta });
    state = studioReducer(state, { type: "sent", at: "9:02", call: "look", text: "more" });
    expect(canUndo(state)).toBe(false);
    expect(studioReducer(state, { type: "undo", at: "9:03" })).toBe(state);
    const empty = initialStudioState("9:00");
    expect(studioReducer(empty, { type: "reset", at: "9:01" })).toBe(empty);
  });

  it("accumulates streamed text only while pending and clears it on reply", () => {
    let state = initialStudioState("9:00");
    expect(studioReducer(state, { type: "streamed", text: "late" }).streaming).toBe("");
    state = studioReducer(state, { type: "sent", at: "9:01", call: "look", text: "gold", note: "party · bold" });
    state = studioReducer(state, { type: "streamed", text: "Warm " });
    state = studioReducer(state, { type: "streamed", text: "glow." });
    expect(state.streaming).toBe("Warm glow.");
    expect(state.messages.at(-1)?.note).toBe("party · bold");
    expect(studioReducer(state, { type: "look-received", at: "9:02", look: gold, meta }).streaming).toBe("");
    expect(studioReducer(state, { type: "failed", at: "9:02", call: "look", error: "x", message: "x" }).streaming).toBe("");
  });
});

describe("prompt composition", () => {
  it("adds occasion and vibe to the request", () => {
    expect(composePrompt("  gold crown ", { occasion: "Party", vibe: 80 })).toBe(
      "gold crown\nOccasion: party.\nVibe: 80/100 (bold). Scale makeup intensity and wearable boldness to match.",
    );
    expect(composePrompt("gold", { occasion: null, vibe: 20 })).not.toContain("Occasion");
    expect(contextNote({ occasion: "Date night", vibe: 50 })).toBe("date night · balanced");
    expect(contextNote({ occasion: null, vibe: 0 })).toBe("subtle");
  });

  it("clamps the vibe", () => {
    expect(clampVibe(140)).toBe(100);
    expect(clampVibe(-3)).toBe(0);
    expect(clampVibe(Number.NaN)).toBe(50);
    expect([vibeLabel(33), vibeLabel(34), vibeLabel(66), vibeLabel(67)]).toEqual(["subtle", "balanced", "balanced", "bold"]);
  });
});

describe("wearable jobs", () => {
  function status(state: JobStatus["state"], progress: number | null = null, error: string | null = null): JobStatus {
    return { state, progress, error };
  }

  it("moves through generating, fitting, and passed", () => {
    let job = startJob(crown);
    job = applyJobStatus(job, status("queued"));
    job = applyJobStatus(job, status("running", 0.5));
    expect(jobPhaseLabel(job)).toBe("generating 50%");
    job = applyJobStatus(job, status("succeeded", 1));
    expect(job.phase).toBe("fitting");
    expect(applyJobStatus(job, status("failed"))).toBe(job);
    expect(finishFit(job, true).phase).toBe("passed");
    expect(finishFit(job, false)).toMatchObject({ phase: "failed", error: "Didn't pass the fit check." });
  });

  it("fails on job errors and never reopens a settled job", () => {
    const failed = applyJobStatus(startJob(crown), status("failed", null, "provider down"));
    expect(failed).toMatchObject({ phase: "failed", error: "provider down" });
    expect(applyJobStatus(failed, status("succeeded"))).toBe(failed);
    expect(failJob(failed, "other")).toBe(failed);
    expect(finishFit(startJob(crown), true).phase).toBe("generating");
  });

  it("validates job events", () => {
    expect(parseJobStatus({ jobId: "j", state: "running", progress: { completed: 1, total: 4 } })).toEqual(status("running", 0.25));
    expect(parseJobStatus({ state: "running", progress: { completed: 9, total: 0 } })).toEqual(status("running"));
    expect(parseJobStatus({ state: "exploded" })).toBeNull();
    expect(parseJobStatus("nope")).toBeNull();
  });

  it("starts jobs only for new visible wearables", () => {
    const hidden: WearableSpec = { ...crown, id: "w2", visible: false };
    const shades: WearableSpec = { ...crown, id: "w3", label: "Shades" };
    expect(jobsToStart([crown, hidden, shades], { w1: startJob(crown) })).toEqual([shades]);
  });

  it("creates a job and streams its statuses", async () => {
    const fetchFn: FetchLike = async (input) =>
      input === "/api/wearable"
        ? new Response(JSON.stringify({ ok: true, jobId: "job-1" }), { status: 200 })
        : new Response('data: {"state":"queued"}\n\ndata: {"state":"bogus"}\n\ndata: {"state":"succeeded"}\n\n', { status: 200 });
    expect(await createWearableJob(crown, { signal, fetchFn })).toEqual({ ok: true, jobId: "job-1" });
    const seen: string[] = [];
    expect(await watchWearableJob("job-1", { signal, fetchFn, onStatus: (next) => seen.push(next.state) })).toEqual({ ok: true });
    expect(seen).toEqual(["queued", "succeeded"]);
  });

  it("reports job request failures", async () => {
    const missing: FetchLike = async () => new Response(JSON.stringify({ ok: false, error: "job_not_found" }), { status: 404 });
    expect(await watchWearableJob("job-x", { signal, fetchFn: missing, onStatus: () => undefined })).toEqual({
      ok: false,
      error: "job_not_found",
      retryAfterS: null,
    });
    const capped: FetchLike = async () => new Response(JSON.stringify({ ok: false, error: "spend_cap_exceeded" }), { status: 429 });
    expect(await createWearableJob(crown, { signal, fetchFn: capped })).toMatchObject({ ok: false, error: "spend_cap_exceeded" });
  });
});

describe("history shortcuts", () => {
  function key(overrides: Partial<ShortcutEvent>): ShortcutEvent {
    return { key: "z", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...overrides };
  }

  it("maps undo and redo keys", () => {
    expect(historyShortcut(key({ ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key({ metaKey: true }))).toBe("undo");
    expect(historyShortcut(key({ metaKey: true, shiftKey: true, key: "Z" }))).toBe("redo");
    expect(historyShortcut(key({ ctrlKey: true, key: "y" }))).toBe("redo");
    expect(historyShortcut(key({}))).toBeNull();
    expect(historyShortcut(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(key({ metaKey: true, key: "y" }))).toBeNull();
  });
});
