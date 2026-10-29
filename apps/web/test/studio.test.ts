import { describe, expect, it } from "vitest";
import type { LookSpec } from "@look-studio/shared";
import { errorMessage, parseMeta, requestEdit, streamLook } from "../src/studio/api-client.ts";
import type { CallMeta, FetchLike } from "../src/studio/api-client.ts";
import { applyEdit, describeEdit } from "../src/studio/look-edits.ts";
import { checkPhoto, MAX_PHOTO_BYTES } from "../src/studio/photo.ts";
import {
  initialStudioState,
  MAX_MONITOR_ENTRIES,
  nextCall,
  studioReducer,
  summarizeMonitor,
} from "../src/studio/studio-state.ts";

const meta: CallMeta = {
  model: "muse-spark-1.3",
  latencyMs: 420,
  tokens: { input: 20, output: 10, total: 30 },
  requestId: "resp_1",
  attempts: 1,
};

const look: LookSpec = {
  id: "look-1",
  name: "Gilded Hour",
  style: "formal",
  palette: ["#FFD700"],
  wearables: [{ id: "w1", type: "hat", label: "Crown", anchor: { region: "head" } }],
};

const signal = new AbortController().signal;

function respond(status: number, payload: unknown, headers: Record<string, string> = {}): FetchLike {
  return async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

function respondSse(events: [string, unknown][]): FetchLike {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const noText = () => undefined;

describe("api client", () => {
  it("streams description text, then returns a validated look with meta", async () => {
    const chunks: string[] = [];
    const fetchFn = respondSse([["delta", { text: "Gold " }], ["delta", { text: "hour." }], ["look", { look, meta }]]);
    const result = await streamLook({ chat: "gold" }, { signal, fetchFn, onText: (text) => chunks.push(text) });
    expect(chunks).toEqual(["Gold ", "hour."]);
    expect(result).toEqual({ ok: true, data: look, meta });
  });

  it("passes streamed error events through", async () => {
    const fetchFn = respondSse([["error", { error: "model_rate_limited", retryAfterS: 4 }]]);
    expect(await streamLook({ chat: "x" }, { signal, fetchFn, onText: noText })).toEqual({
      ok: false,
      error: "model_rate_limited",
      retryAfterS: 4,
    });
    const ended = await streamLook({ chat: "x" }, { signal, fetchFn: respondSse([["delta", { text: "a" }]]), onText: noText });
    expect(ended).toEqual({ ok: false, error: "bad_response", retryAfterS: null });
  });

  it("rejects responses that fail validation", async () => {
    const badLook = await streamLook({ chat: "x" }, { signal, fetchFn: respondSse([["look", { look: { id: "" }, meta }]]), onText: noText });
    expect(badLook).toEqual({ ok: false, error: "bad_response", retryAfterS: null });
    const badMeta = await requestEdit(
      { utterance: "x", look },
      { signal, fetchFn: respond(200, { ok: true, command: { op: "toggle", targetId: "w1" }, meta: { model: 1 } }) },
    );
    expect(badMeta.ok).toBe(false);
  });

  it("passes server errors and Retry-After through", async () => {
    const result = await streamLook(
      { chat: "x" },
      { signal, fetchFn: respond(429, { ok: false, error: "model_rate_limited" }, { "retry-after": "3" }), onText: noText },
    );
    expect(result).toEqual({ ok: false, error: "model_rate_limited", retryAfterS: 3 });
    expect(errorMessage("model_rate_limited", 3)).toContain("3s");
    expect(errorMessage("skin_tone_change", null)).toContain("keeps your own skin tone");
  });

  it("reports network failures and timeouts", async () => {
    const offline: FetchLike = async () => {
      throw new TypeError("failed to fetch");
    };
    expect(await streamLook({ chat: "x" }, { signal, fetchFn: offline, onText: noText })).toEqual({
      ok: false,
      error: "network",
      retryAfterS: null,
    });
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const timedOut = await streamLook({ chat: "x" }, { signal, fetchFn: hanging, timeoutMs: 5, onText: noText });
    expect(timedOut).toEqual({ ok: false, error: "timeout", retryAfterS: null });
  });

  it("parses meta strictly", () => {
    expect(parseMeta(meta)).toEqual(meta);
    expect(parseMeta({ ...meta, latencyMs: -1 })).toBeNull();
    expect(parseMeta(null)).toBeNull();
  });
});

describe("look edits", () => {
  it("applies each op without mutating the look", () => {
    expect(applyEdit(look, { op: "toggle", targetId: "w1" }).wearables[0].visible).toBe(false);
    expect(applyEdit(look, { op: "remove", targetId: "w1" }).wearables).toHaveLength(0);
    expect(applyEdit(look, { op: "scale", targetId: "w1", factor: 2 }).wearables[0].scale).toBe(2);
    expect(applyEdit(look, { op: "move", targetId: "w1", delta: { x: 0, y: 0.2, z: 0 } }).wearables[0].anchor.offset).toEqual({
      x: 0,
      y: 0.2,
      z: 0,
    });
    expect(applyEdit(look, { op: "recolor", targetId: "w1", color: "#ff0000" }).palette).toEqual(["#ff0000", "#FFD700"]);
    const added = applyEdit(look, {
      op: "add",
      targetId: "w2",
      wearable: { id: "w2", type: "glasses", label: "Hearts", anchor: { region: "face" } },
    });
    expect(added.wearables.map((wearable) => wearable.id)).toEqual(["w1", "w2"]);
    expect(look.wearables).toHaveLength(1);
  });

  it("applies makeup edits per area and keeps finishes", () => {
    const pink = applyEdit(look, { op: "makeup", targetId: "brows", color: "#ff69b4", opacity: 0.8 });
    expect(pink.makeup).toEqual({ brows: { color: "#ff69b4", opacity: 0.8 } });
    const glossy = { ...look, makeup: { lips: { color: "#aa0000", opacity: 0.6, finish: "gloss" as const } } };
    expect(applyEdit(glossy, { op: "makeup", targetId: "lips", color: "#0000ff" }).makeup?.lips).toEqual({
      color: "#0000ff",
      opacity: 0.6,
      finish: "gloss",
    });
    expect(applyEdit(glossy, { op: "makeup", targetId: "lips", opacity: 0 })).not.toHaveProperty("makeup");
    expect(applyEdit(look, { op: "makeup", targetId: "brows", color: "#ff69b4" })).toBe(look);
    expect(applyEdit(look, { op: "makeup", targetId: "hair", color: "#ff69b4", opacity: 0.5 })).toBe(look);
  });

  it("describes edits in plain words", () => {
    expect(describeEdit(look, { op: "move", targetId: "w1", delta: { x: 0, y: 0.2, z: 0 } })).toBe("Moved Crown up.");
    expect(describeEdit(look, { op: "toggle", targetId: "w1" })).toBe("Hid Crown.");
    expect(describeEdit(look, { op: "scale", targetId: "w1", factor: 0.5 })).toBe("Made Crown smaller.");
    expect(describeEdit(look, { op: "makeup", targetId: "brows", color: "#FF69B4" })).toBe("Changed brows to #FF69B4.");
    expect(describeEdit(look, { op: "makeup", targetId: "lips", opacity: 0 })).toBe("Took off the lips colour.");
  });
});

describe("studio state", () => {
  it("routes the first message and photos to look, later ones to edit", () => {
    const start = initialStudioState("9:00");
    expect(nextCall(start, false)).toBe("look");
    const withLook = studioReducer(start, { type: "look-received", at: "9:01", look, meta });
    expect(nextCall(withLook, false)).toBe("edit");
    expect(nextCall(withLook, true)).toBe("look");
    expect(nextCall(studioReducer(withLook, { type: "reset", at: "9:02" }), false)).toBe("look");
  });

  it("records calls and failures in the monitor", () => {
    let state = initialStudioState("9:00");
    state = studioReducer(state, { type: "sent", at: "9:00", call: "look", text: "gold" });
    expect(state.pending).toBe(true);
    state = studioReducer(state, { type: "look-received", at: "9:01", look, meta });
    state = studioReducer(state, { type: "edit-received", at: "9:02", command: { op: "toggle", targetId: "w1" }, meta });
    state = studioReducer(state, { type: "failed", at: "9:03", call: "edit", error: "network", message: "offline" });
    expect(state.pending).toBe(false);
    expect(state.look?.wearables[0].visible).toBe(false);
    expect(state.monitor.map((entry) => entry.call)).toEqual(["edit", "edit", "look"]);
    expect(new Set(state.messages.map((message) => message.id)).size).toBe(state.messages.length);
    expect(summarizeMonitor(state.monitor)).toEqual({ calls: 3, failures: 1, avgLatencyMs: 420, totalTokens: 60, live: true });
  });

  it("tracks the pending call and keeps cancels out of the monitor", () => {
    let state = initialStudioState("9:00");
    state = studioReducer(state, { type: "sent", at: "9:00", call: "look", text: "gold" });
    expect(state.pendingCall).toBe("look");
    state = studioReducer(state, { type: "failed", at: "9:01", call: "look", error: "aborted", message: "Request cancelled." });
    expect(state.pendingCall).toBeNull();
    expect(state.pending).toBe(false);
    expect(state.monitor).toHaveLength(0);
    expect(state.messages.at(-1)?.text).toBe("Request cancelled.");
  });

  it("caps the monitor and flags offline replies", () => {
    let state = initialStudioState("9:00");
    for (let i = 0; i < MAX_MONITOR_ENTRIES + 5; i += 1) {
      state = studioReducer(state, { type: "look-received", at: "9:00", look, meta: { ...meta, model: "offline-fake" } });
    }
    expect(state.monitor).toHaveLength(MAX_MONITOR_ENTRIES);
    expect(summarizeMonitor(state.monitor).live).toBe(false);
  });
});

describe("photo checks", () => {
  it("accepts small images and rejects other types or large files", () => {
    expect(checkPhoto({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkPhoto({ type: "image/gif", size: 1000 })).toBe("type");
    expect(checkPhoto({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toBe("size");
  });
});
