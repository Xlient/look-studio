import { describe, expect, it } from "vitest";
import { createMakeupGeometry } from "../src/scene/makeup-regions.ts";
import type { MakeupGeometry, Polygon } from "../src/scene/makeup-regions.ts";
import { createSkinSmoother, touchUpSettings, writeFaceBounds } from "../src/scene/skin-smoother.ts";
import type { SmoothLayer, SmoothTarget } from "../src/scene/skin-smoother.ts";

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

function recordingLayer(log: string[], name: string): SmoothLayer {
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
    drawImage: (...args: unknown[]) => log.push(`${name}:draw:${ctx.globalCompositeOperation}:${ctx.filter}:${args.length}`),
  };
  return { canvas, ctx } as unknown as SmoothLayer;
}

function recordingTarget(log: string[]): SmoothTarget {
  const target = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    save: () => log.push("target:save"),
    restore: () => log.push("target:restore"),
    drawImage: () => log.push(`target:draw:${target.globalAlpha.toFixed(2)}`),
  };
  return target as unknown as SmoothTarget;
}

describe("touchUpSettings", () => {
  it("is off at zero, invalid, or without a face size", () => {
    expect(touchUpSettings(0, 100)).toBeNull();
    expect(touchUpSettings(Number.NaN, 100)).toBeNull();
    expect(touchUpSettings(0.5, 0)).toBeNull();
  });

  it("scales the mix with strength and the blur with face size", () => {
    expect(touchUpSettings(1, 100)).toEqual({ alpha: 0.75, blurPx: 4, featherPx: 10 });
    expect(touchUpSettings(5, 200)).toEqual({ alpha: 0.75, blurPx: 8, featherPx: 20 });
    expect(touchUpSettings(0.4, 100)?.alpha).toBeCloseTo(0.3);
  });
});

describe("writeFaceBounds", () => {
  it("pads the oval and clamps to the frame", () => {
    const oval = createMakeupGeometry().faceOval;
    square(oval, 10, 20, 600, 470);
    expect(writeFaceBounds({ x: 0, y: 0, w: 0, h: 0 }, oval, 30, 640, 480)).toEqual({ x: 0, y: 0, w: 630, h: 480 });
  });

  it("returns null without points", () => {
    expect(writeFaceBounds({ x: 0, y: 0, w: 0, h: 0 }, createMakeupGeometry().faceOval, 30, 640, 480)).toBeNull();
  });
});

describe("createSkinSmoother", () => {
  it("masks the skin, blurs only the face area at half size, and mixes it in", () => {
    const log: string[] = [];
    const layers = [recordingLayer(log, "mask"), recordingLayer(log, "blur")];
    const smoother = createSkinSmoother(() => layers.shift() ?? null);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), 1, 640, 480);
    expect(log).toEqual([
      "mask:clear",
      "mask:fill:source-over:blur(5px)",
      "mask:fill:destination-out:blur(2.5px)",
      "blur:clear",
      "blur:draw:source-over:blur(2px):9",
      "blur:draw:destination-in:none:3",
      "target:save",
      "target:draw:0.75",
      "target:restore",
    ]);
  });

  it("does nothing when off, untracked, or without canvases", () => {
    const log: string[] = [];
    const layers = [recordingLayer(log, "mask"), recordingLayer(log, "blur")];
    const smoother = createSkinSmoother(() => layers.shift() ?? null);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), 0, 640, 480);
    smoother.apply(recordingTarget(log), {} as CanvasImageSource, createMakeupGeometry(), 1, 640, 480);
    createSkinSmoother(() => null).apply(recordingTarget(log), {} as CanvasImageSource, trackedFace(), 1, 640, 480);
    expect(log).toEqual([]);
  });

  it("sizes its canvases to half the frame", () => {
    const layers = [recordingLayer([], "mask"), recordingLayer([], "blur")];
    const [mask] = layers;
    const smoother = createSkinSmoother(() => layers.shift() ?? null);
    smoother.apply(recordingTarget([]), {} as CanvasImageSource, trackedFace(), 0.5, 641, 480);
    expect([mask?.canvas.width, mask?.canvas.height]).toEqual([321, 240]);
  });
});
