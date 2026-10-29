import { describe, expect, it } from "vitest";
import type { MonitorEntry } from "../src/studio/studio-state.ts";
import { thinkingStatus, typicalLatencyMs } from "../src/studio/thinking.ts";

function entry(id: number, call: "look" | "edit", latencyMs: number, ok = true): MonitorEntry {
  return { id, at: "9:00", call, model: "muse-spark-1.3", ok, latencyMs, tokens: 10, requestId: null };
}

describe("typicalLatencyMs", () => {
  it("returns null without successful calls of that kind", () => {
    expect(typicalLatencyMs([], "look")).toBeNull();
    expect(typicalLatencyMs([entry(1, "edit", 900), entry(2, "look", 0, false)], "look")).toBeNull();
  });

  it("takes the median of the five newest successful calls", () => {
    const newestFirst = [
      entry(9, "look", 4000),
      entry(8, "edit", 100),
      entry(7, "look", 3000),
      entry(6, "look", 0, false),
      entry(5, "look", 5000),
      entry(4, "look", 6000),
      entry(3, "look", 2000),
      entry(2, "look", 60_000),
    ];
    expect(typicalLatencyMs(newestFirst, "look")).toBe(4000);
    expect(typicalLatencyMs(newestFirst.slice(0, 3), "look")).toBe(3500);
  });
});

describe("thinkingStatus", () => {
  it("names the call and counts whole seconds", () => {
    expect(thinkingStatus("look", 2999, null)).toEqual({ title: "LookArtist is designing your look", elapsed: "2s", hint: "" });
    expect(thinkingStatus("edit", -5, null).title).toBe("LookArtist is updating your look");
    expect(thinkingStatus("edit", -5, null).elapsed).toBe("0s");
  });

  it("gives a typical time, then says when it runs long", () => {
    expect(thinkingStatus("look", 1000, 4200).hint).toBe("Usually about 4s");
    expect(thinkingStatus("look", 100, 200).hint).toBe("Usually about 1s");
    expect(thinkingStatus("look", 8401, 4200).hint).toBe("Taking longer than usual");
  });
});
