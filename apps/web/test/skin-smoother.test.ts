import { describe, expect, it } from "vitest";
import { createMakeupGeometry } from "../src/scene/makeup-regions.ts";
import type { MakeupGeometry, Polygon } from "../src/scene/makeup-regions.ts";
import {
  NO_SKIN,
  coverageAlpha,
  createSkinSmoother,
  meanShade,
  smoothingSettings,
  writeFaceBounds,
} from "../src/scene/skin-smoother.ts";
import type { SkinRender, SmoothLayer, SmoothTarget } from "../src/scene/skin-smoother.ts";

function square(shape: Polygon, x0: number, y0: number, x1: number, y1: number) {
  shape.points.set([x0, y0, x1, y0, x1, y1, x0, y1]);
  shape.count = 4;
}

function trackedFace(): MakeupGeometry {
  const geometry = createMakeupGeometry();
  square(geometry.faceOval, 200, 100, 400, 360);
  square(geometry.rightEye, 240, 180, 280, 200);
  geometry.eyeDistance = 100;
  geometry.visible = true;
  return geometry;
}

function recordingLayer(log: string[], name: string, pixels: number[] = []): SmoothLayer {
  const canvas = { width: 0, height: 0 };
  const ctx = {
    canvas,
    filter: "none",
    fillStyle: "#000",
    globalCompositeOperation: "source-over",
    setTransform: () => {},
    clearRect: () => log.push(`${name}:clear`),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => log.push(`${name}:fill:${ctx.globalCompositeOperation}:${ctx.filter}`),
    fillRect: () => log.push(`${name}:rect:${ctx.fillStyle}`),
    drawImage: (...args: unknown[]) => log.push(`${name}:draw:${ctx.globalCompositeOperation}:${ctx.filter}:${args.length}`),
    getImageData: () => ({ data: Uint8ClampedArray.from(pixels) }),
  };
  return { canvas, ctx } as unknown as SmoothLayer;
}

function recordingTarget(log: string[]): SmoothTarget {
  const target = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    save: () => {},
    restore: () => {},
    drawImage: () => log.push(`target:${target.globalCompositeOperation}:${target.globalAlpha.toFixed(2)}`),
  };
  return target as unknown as SmoothTarget;
}

function smootherWith(log: string[], pixels: number[] = []) {
  const layers = [recordingLayer(log, "mask"), recordingLayer(log, "work"), recordingLayer(log, "sample", pixels)];
  return createSkinSmoother(() => layers.shift() ?? null);
}

const skin = (overrides: Partial<SkinRender>): SkinRender => ({ ...NO_SKIN, ...overrides });
const SKIN_PIXELS = [200, 150, 120, 255, 100, 50, 40, 255, 0, 0, 0, 10];

describe("skin settings", () => {
  it("turns smoothing off at zero, invalid, or without a face size", () => {
    expect(smoothingSettings(0, 100)).toBeNull();
    expect(smoothingSettings(Number.NaN, 100)).toBeNull();
    expect(smoothingSettings(0.5, 0)).toBeNull();
    expect(smoothingSettings(5, 200)).toEqual({ alpha: 0.75, blurPx: 8 });
  });

  it("raises foundation opacity with coverage", () => {
    const levels = (["none", "sheer", "light", "medium", "full"] as const).map(coverageAlpha);
    expect(levels[0]).toBe(0);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(levels[4]).toBeLessThan(0.5);
  });
});

describe("meanShade", () => {
  it("averages only opaque mask pixels", () => {
    expect(meanShade(SKIN_PIXELS)).toBe("#966450");
    expect(meanShade([10, 10, 10, 0])).toBeNull();
    expect(meanShade([])).toBeNull();
  });
});

describe("writeFaceBounds", () => {
  it("pads the oval and clamps to the frame", () => {
    const oval = createMakeupGeometry().faceOval;
    square(oval, 10, 20, 600, 470);
    expect(writeFaceBounds({ x: 0, y: 0, w: 0, h: 0 }, oval, 30, 640, 480)).toEqual({ x: 0, y: 0, w: 630, h: 480 });
    expect(writeFaceBounds({ x: 0, y: 0, w: 0, h: 0 }, createMakeupGeometry().faceOval, 30, 640, 480)).toBeNull();
  });
});

describe("createSkinSmoother", () => {
  it("masks the skin, blurs the face area at half size, and mixes it in", () => {
    const log: string[] = [];
    smootherWith(log).apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ smoothing: 1 }), 640, 480);
    expect(log).toEqual([
      "mask:clear",
      "mask:fill:source-over:blur(5px)",
      "mask:fill:destination-out:blur(2.5px)",
      "work:clear",
      "work:draw:source-over:blur(2px):9",
      "work:draw:destination-in:none:3",
      "target:source-over:0.75",
    ]);
  });

  it("tints with the shade sampled from the user's own face, then adds dewy glow", () => {
    const log: string[] = [];
    const smoother = smootherWith(log, SKIN_PIXELS);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ coverage: "medium", finish: "dewy" }), 640, 480);
    expect(log.filter((line) => line.startsWith("sample:draw") || line.includes("rect") || line.startsWith("target"))).toEqual([
      "sample:draw:source-over:none:9",
      "sample:draw:destination-in:none:9",
      "work:rect:#966450",
      `target:source-over:${coverageAlpha("medium").toFixed(2)}`,
      "work:rect:#ffffff",
      "target:soft-light:0.14",
    ]);
  });

  it("resamples about once a second and after the face is lost", () => {
    const log: string[] = [];
    const smoother = smootherWith(log, SKIN_PIXELS);
    const sampled = () => log.filter((line) => line === "sample:clear").length;
    for (let frame = 0; frame < 31; frame += 1) {
      smoother.apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ coverage: "light" }), 640, 480);
    }
    expect(sampled()).toBe(2);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, createMakeupGeometry(), skin({ coverage: "light" }), 640, 480);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ coverage: "light" }), 640, 480);
    expect(sampled()).toBe(3);
  });

  it("skips the foundation when no skin pixels are found", () => {
    const log: string[] = [];
    smootherWith(log, [0, 0, 0, 0]).apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ coverage: "full" }), 640, 480);
    expect(log.some((line) => line.startsWith("target"))).toBe(false);
  });

  it("does nothing when everything is off, untracked, or without canvases", () => {
    const log: string[] = [];
    smootherWith(log).apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), NO_SKIN, 640, 480);
    smootherWith(log).apply(recordingTarget(log), {} as CanvasImageSource, createMakeupGeometry(), skin({ smoothing: 1 }), 640, 480);
    createSkinSmoother(() => null).apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), skin({ smoothing: 1 }), 640, 480);
    expect(log).toEqual([]);
  });

  it("sizes its working canvases to half the frame", () => {
    const layers = [recordingLayer([], "mask"), recordingLayer([], "work"), recordingLayer([], "sample")];
    const [mask] = layers;
    createSkinSmoother(() => layers.shift() ?? null).apply(
      recordingTarget([]),
      {} as CanvasImageSource,
      trackedFace(),
      skin({ smoothing: 0.5 }),
      641,
      480,
    );
    expect([mask?.canvas.width, mask?.canvas.height]).toEqual([321, 240]);
  });
});
