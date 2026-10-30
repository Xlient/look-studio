import { describe, expect, it } from "vitest";
import type { LookSpec, WearableSpec } from "@look-studio/shared";
import {
  DEFAULT_GLASSES_COLOR,
  DEFAULT_HEAD_COLOR,
  EMPTY_LAYOUT,
  HEAD_WIDTHS_TO_EYE_SPANS,
  OFFSET_LIMIT,
  SCALE_LIMITS,
  headTemplate,
  hexColor,
  wearableLayout,
} from "../src/scene/wearable-layout.ts";

function wearable(overrides: Partial<WearableSpec>): WearableSpec {
  return { id: "w", type: "hat", label: "Hat", anchor: { region: "head" }, ...overrides };
}

function look(wearables: WearableSpec[], palette?: string[]): LookSpec {
  return { id: "l", name: "Look", style: "casual", wearables, ...(palette === undefined ? {} : { palette }) };
}

describe("headTemplate", () => {
  it("picks crown for crown-like labels and hat for other hats", () => {
    expect(headTemplate(wearable({ label: "Gold Tiara" }))).toBe("crown");
    expect(headTemplate(wearable({ label: "flower crown" }))).toBe("crown");
    expect(headTemplate(wearable({ label: "Diadems" }))).toBe("crown");
    expect(headTemplate(wearable({ label: "Plum Velvet Beret" }))).toBe("hat");
    expect(headTemplate(wearable({ label: "Crowned cap", type: "glasses" }))).toBeNull();
    expect(headTemplate(wearable({ label: "Crownless" }))).toBe("hat");
  });
});

describe("wearableLayout", () => {
  it("is empty without a look or without drawable wearables", () => {
    expect(wearableLayout(null)).toBe(EMPTY_LAYOUT);
    const other = [wearable({ type: "necklace", label: "Chain" }), wearable({ type: "watch", label: "Watch" })];
    expect(wearableLayout(look(other))).toEqual(EMPTY_LAYOUT);
  });

  it("fills head and eye slots with palette colours", () => {
    const layout = wearableLayout(
      look([wearable({ id: "h", label: "Gold Crown" }), wearable({ id: "g", type: "glasses", label: "Star Shades" })], ["#FF00FF", "#00FFFF"]),
    );
    expect(layout.head).toEqual({ id: "h", template: "crown", color: 0xff00ff, scale: 1, offset: { x: 0, y: 0, z: 0 } });
    expect(layout.eyes).toEqual({ id: "g", color: 0x00ffff, scale: 1, offset: { x: 0, y: 0, z: 0 } });
  });

  it("prefers each wearable's own colour, so recolouring glasses leaves the hat alone", () => {
    const layout = wearableLayout(
      look([wearable({ id: "h", label: "Gold Crown" }), wearable({ id: "g", type: "glasses", label: "Specs", color: "#FFFFFF" })], ["#FF00FF", "#00FFFF"]),
    );
    expect(layout.eyes?.color).toBe(0xffffff);
    expect(layout.head?.color).toBe(0xff00ff);
  });

  it("falls back to default colours", () => {
    const layout = wearableLayout(look([wearable({ id: "h" }), wearable({ id: "g", type: "glasses", label: "Specs" })], ["#123456"]));
    expect(layout.head?.color).toBe(0x123456);
    expect(layout.eyes?.color).toBe(DEFAULT_GLASSES_COLOR);
    expect(wearableLayout(look([wearable({ id: "h" })])).head?.color).toBe(DEFAULT_HEAD_COLOR);
  });

  it("lets the first visible item win each slot", () => {
    const layout = wearableLayout(
      look([
        wearable({ id: "hidden", label: "Crown", visible: false }),
        wearable({ id: "beret", label: "Beret" }),
        wearable({ id: "crown", label: "Crown" }),
      ]),
    );
    expect(layout.head).toMatchObject({ id: "beret", template: "hat" });
  });

  it("clamps scale and converts offsets from head widths", () => {
    const layout = wearableLayout(
      look([wearable({ scale: 50, anchor: { region: "head", offset: { x: 0.5, y: -9, z: 0 } } }), wearable({ id: "g", type: "glasses", label: "S", scale: 0.01 })]),
    );
    expect(layout.head?.scale).toBe(SCALE_LIMITS.max);
    expect(layout.eyes?.scale).toBe(SCALE_LIMITS.min);
    expect(layout.head?.offset.x).toBeCloseTo(0.5 * HEAD_WIDTHS_TO_EYE_SPANS);
    expect(layout.head?.offset.y).toBeCloseTo(-OFFSET_LIMIT * HEAD_WIDTHS_TO_EYE_SPANS);
  });
});

describe("hexColor", () => {
  it("parses six-digit hex and rejects anything else", () => {
    expect(hexColor("#FFD700", 1)).toBe(0xffd700);
    expect(hexColor("gold", 1)).toBe(1);
    expect(hexColor(undefined, 2)).toBe(2);
  });
});
