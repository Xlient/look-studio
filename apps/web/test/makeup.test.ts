import { describe, expect, it } from "vitest";
import type { Makeup } from "@look-studio/shared";
import { createMakeupPainter } from "../src/scene/makeup-painter.ts";
import type { SkinSmoother } from "../src/scene/skin-smoother.ts";
import type { PaintContext } from "../src/scene/makeup-painter.ts";
import { createMakeupGeometry, writeMakeupGeometry } from "../src/scene/makeup-regions.ts";
import { featherPx, isVividTint, makeupPasses } from "../src/scene/makeup-style.ts";
import { createHeadState } from "../src/tracking/head-state.ts";
import type { HeadState } from "../src/tracking/head-state.ts";

const FULL: Makeup = {
  lips: { color: "#c2185b", opacity: 0.7, finish: "gloss" },
  blush: { color: "#ff8a80", opacity: 0.3 },
  eyeshadow: { color: "#7e57c2", opacity: 0.5, finish: "shimmer" },
  brows: { color: "#4e342e", opacity: 0.4 },
};

function face(): HeadState {
  const state = createHeadState();
  for (let i = 0; i < 478; i += 1) {
    state.landmarks[i * 3] = 0.3 + (i % 20) * 0.02;
    state.landmarks[i * 3 + 1] = 0.3 + Math.floor(i / 20) * 0.015;
  }
  state.landmarks[33 * 3] = 0.4;
  state.landmarks[263 * 3] = 0.6;
  state.landmarks[33 * 3 + 1] = state.landmarks[263 * 3 + 1] = 0.45;
  state.landmarkCount = 478;
  state.confidence = 1;
  return state;
}

function recordingContext() {
  const calls: string[] = [];
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", fillStyle: "#000" };
  const ctx = {
    ...state,
    drawImage: () => calls.push("drawImage"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    ellipse: () => calls.push("ellipse"),
    fill: (rule?: string) => calls.push(`fill:${rule ?? ""}:${String(ctx.globalCompositeOperation)}`),
  };
  return { ctx: ctx as unknown as PaintContext, calls };
}

describe("writeMakeupGeometry", () => {
  it("fills every region in pixels and reuses buffers", () => {
    const geometry = createMakeupGeometry();
    const { points } = geometry.lipsOuter;
    writeMakeupGeometry(geometry, face(), 640, 480);
    writeMakeupGeometry(geometry, face(), 640, 480);
    expect(geometry.visible).toBe(true);
    expect(geometry.lipsOuter.points).toBe(points);
    expect(geometry.lipsOuter.count).toBe(20);
    expect(geometry.lipsInner.count).toBe(20);
    expect(geometry.rightShadow.count).toBe(14);
    expect(geometry.leftBrow.count).toBe(10);
    expect(geometry.faceOval.count).toBe(36);
    expect(geometry.rightEye.count).toBe(16);
    expect(geometry.leftEye.count).toBe(16);
    expect(geometry.eyeDistance).toBeCloseTo(128);
    expect(Math.max(...geometry.lipsOuter.points)).toBeLessThanOrEqual(640);
  });

  it("puts the shadow's return edge between lid and brow", () => {
    const state = face();
    state.landmarks[133 * 3 + 1] = 0.5;
    state.landmarks[55 * 3 + 1] = 0.4;
    const geometry = writeMakeupGeometry(createMakeupGeometry(), state, 100, 100);
    const lastY = geometry.rightShadow.points[(geometry.rightShadow.count - 5) * 2 + 1] ?? 0;
    expect(lastY).toBeCloseTo(50 + (40 - 50) * 0.55);
  });

  it("hides without a confident face", () => {
    const weak = face();
    weak.confidence = 0.1;
    expect(writeMakeupGeometry(createMakeupGeometry(), weak, 640, 480).visible).toBe(false);
    expect(writeMakeupGeometry(createMakeupGeometry(), null, 640, 480).visible).toBe(false);
  });
});

describe("makeupPasses", () => {
  it("returns nothing without makeup", () => {
    expect(makeupPasses(undefined)).toEqual([]);
  });

  it("adds highlight passes for gloss and shimmer", () => {
    const regions = makeupPasses(FULL).map((pass) => `${pass.region}:${pass.op}`);
    expect(regions).toEqual([
      "blush:multiply",
      "eyeshadow:multiply",
      "eyeshadow:soft-light",
      "brows:multiply",
      "lips:multiply",
      "gloss:screen",
    ]);
  });

  it("maps lip finishes to distinct blends", () => {
    const op = (finish: "matte" | "satin" | "gloss") =>
      makeupPasses({ lips: { color: "#aa0000", opacity: 0.6, finish } }).map((pass) => pass.op);
    expect(op("matte")).toEqual(["multiply"]);
    expect(op("satin")).toEqual(["color"]);
    expect(op("gloss")).toEqual(["multiply", "screen"]);
  });

  it("treats saturated or pastel light colours as vivid", () => {
    expect(["#ff69b4", "#00e5ff", "#e0e0e0", "#ffffff"].map(isVividTint)).toEqual([true, true, true, true]);
    expect(["#4e342e", "#7e57c2", "#c8a08a", "#000000", "pink", "#ff69b"].map(isVividTint)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("covers dark brows with vivid colours instead of only darkening", () => {
    const ops = (color: string) =>
      makeupPasses({ brows: { color, opacity: 0.8 } }).map((pass) => `${pass.op}:${pass.alpha.toFixed(2)}`);
    expect(ops("#4e342e")).toEqual(["multiply:0.80"]);
    expect(ops("#ff69b4")).toEqual(["color:0.80", "source-over:0.48"]);
    const shadow = makeupPasses({ eyeshadow: { color: "#00e5ff", opacity: 0.5, finish: "shimmer" } });
    expect(shadow.map((pass) => pass.op)).toEqual(["color", "source-over", "soft-light"]);
  });

  it("scales feather with face size", () => {
    const [blush] = makeupPasses({ blush: { color: "#ff8a80", opacity: 0.3 } });
    expect(blush).toBeDefined();
    if (blush !== undefined) {
      expect(featherPx(blush, 200)).toBe(2 * featherPx(blush, 100));
      expect(featherPx(blush, 0)).toBe(0.5);
    }
  });
});

describe("createMakeupPainter", () => {
  it("draws the frame then only the enabled regions with even-odd fills", () => {
    const { ctx, calls } = recordingContext();
    const geometry = writeMakeupGeometry(createMakeupGeometry(), face(), 640, 480);
    createMakeupPainter(ctx).paint({} as CanvasImageSource, geometry, makeupPasses({ lips: FULL.lips }), 640, 480);
    expect(calls[0]).toBe("drawImage");
    expect(calls.filter((call) => call.startsWith("fill"))).toEqual(["fill:evenodd:multiply", "fill:evenodd:screen"]);
    expect(calls.filter((call) => call === "save").length).toBe(calls.filter((call) => call === "restore").length);
  });

  it("touches up the skin after the frame and before makeup", () => {
    const { ctx, calls } = recordingContext();
    const strengths: number[] = [];
    const smoother = {
      apply: (_target: unknown, _source: unknown, _geometry: unknown, strength: number) => {
        calls.push(`smooth:${strength}`);
        strengths.push(strength);
      },
    };
    const geometry = writeMakeupGeometry(createMakeupGeometry(), face(), 640, 480);
    const painter = createMakeupPainter(ctx, smoother as unknown as SkinSmoother);
    painter.paint({} as CanvasImageSource, geometry, makeupPasses({ lips: FULL.lips }), 640, 480, 0.4);
    expect(calls.slice(0, 2)).toEqual(["drawImage", "smooth:0.4"]);
    painter.paint({} as CanvasImageSource, createMakeupGeometry(), [], 640, 480, 0.4);
    expect(strengths).toEqual([0.4]);
  });

  it("draws only the video frame when no face is tracked", () => {
    const { ctx, calls } = recordingContext();
    createMakeupPainter(ctx).paint({} as CanvasImageSource, createMakeupGeometry(), makeupPasses(FULL), 640, 480);
    expect(calls).toEqual(["drawImage"]);
  });
});
