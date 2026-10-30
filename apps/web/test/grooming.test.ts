import { describe, expect, it } from "vitest";
import type { Grooming } from "@look-studio/shared";
import {
  GREY_HAIR,
  createHairPatterns,
  hairTilePixels,
  mixHex,
  seededRandom,
  writePatternTransform,
} from "../src/scene/hair-texture.ts";
import type { HairTexture } from "../src/scene/hair-texture.ts";
import { createMakeupPainter } from "../src/scene/makeup-painter.ts";
import type { PaintContext } from "../src/scene/makeup-painter.ts";
import { NATURAL_SHAPE, createMakeupGeometry, writeMakeupGeometry } from "../src/scene/makeup-regions.ts";
import type { Polygon } from "../src/scene/makeup-regions.ts";
import { groomingShape, makeupPasses } from "../src/scene/makeup-style.ts";
import { createHeadState } from "../src/tracking/head-state.ts";
import type { HeadState } from "../src/tracking/head-state.ts";

const NOSE_TIP = 1;

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

function point(shape: Polygon, i: number): [number, number] {
  return [shape.points[i * 2] ?? 0, shape.points[i * 2 + 1] ?? 0];
}

const boxedHair = { style: "boxed", length: 1, density: 0.8, color: "#3b2a20", grey: 0.5 } as const;
const boxed: Grooming = { facialHair: boxedHair };
const hairTexture: HairTexture = { color: "#3b2a20", grey: 0, density: 0.8, strand: "hair" };

function opaqueShare(pixels: Uint8ClampedArray): number {
  let opaque = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    opaque += (pixels[i] ?? 0) > 0 ? 1 : 0;
  }
  return opaque / (pixels.length / 4);
}

describe("grooming regions", () => {
  it("builds mustache, goatee, beard, and chin from landmarks", () => {
    const geometry = writeMakeupGeometry(createMakeupGeometry(), face(), 640, 480);
    expect([geometry.mustache.count, geometry.goatee.count, geometry.beard.count]).toEqual([20, 16, 40]);
    expect(geometry.chin[0]).toBeCloseTo((0.3 + (152 % 20) * 0.02) * 640);
  });

  it("pushes only the jaw and chin outward with beard length", () => {
    const state = face();
    const plain = writeMakeupGeometry(createMakeupGeometry(), state, 640, 480);
    const long = writeMakeupGeometry(createMakeupGeometry(), state, 640, 480, { browScale: 1, beardReach: 0.5 });
    const nose: [number, number] = [(state.landmarks[NOSE_TIP * 3] ?? 0) * 640, (state.landmarks[NOSE_TIP * 3 + 1] ?? 0) * 480];
    const distance = (p: [number, number]) => Math.hypot(p[0] - nose[0], p[1] - nose[1]);
    expect(distance(point(long.beard, 11)) - distance(point(plain.beard, 11))).toBeCloseTo(0.5 * plain.eyeDistance, 3);
    expect(point(long.beard, 30)).toEqual(point(plain.beard, 30));
    expect(point(long.goatee, 13)).not.toEqual(point(plain.goatee, 13));
    expect(point(long.goatee, 5)).toEqual(point(plain.goatee, 5));
  });

  it("thickens fuller brows and slims tidy ones about the same midline", () => {
    const thickness = (scale: number) => {
      const brow = writeMakeupGeometry(createMakeupGeometry(), face(), 640, 480, { ...NATURAL_SHAPE, browScale: scale }).rightBrow;
      const [ux, uy] = point(brow, 0);
      const [lx, ly] = point(brow, brow.count - 1);
      return { gap: Math.hypot(ux - lx, uy - ly), mid: [(ux + lx) / 2, (uy + ly) / 2] };
    };
    const natural = thickness(1);
    expect(thickness(1.3).gap).toBeCloseTo(natural.gap * 1.3);
    expect(thickness(0.85).gap).toBeCloseTo(natural.gap * 0.85);
    expect(thickness(1.3).mid[1]).toBeCloseTo(natural.mid[1] ?? 0);
  });
});

describe("grooming passes", () => {
  it("maps each style to its regions with a shadow and a strand pass", () => {
    const regions = (style: "stubble" | "mustache" | "goatee" | "full") =>
      makeupPasses(undefined, { facialHair: { style, length: 0.5, density: 0.6, color: "#222222", grey: 0 } }).map(
        (pass) => `${pass.region}:${pass.texture?.strand ?? pass.op}`,
      );
    expect(regions("mustache")).toEqual(["mustache:multiply", "mustache:hair"]);
    expect(regions("goatee")).toEqual(["goatee:multiply", "goatee:hair", "mustache:multiply", "mustache:hair"]);
    expect(regions("stubble")).toEqual(["beard:multiply", "beard:stubble", "mustache:multiply", "mustache:stubble"]);
    expect(makeupPasses(undefined, { brows: "tidy" })).toEqual([]);
  });

  it("blends grey into the shadow colour and scales reach by style", () => {
    const [shadow] = makeupPasses(undefined, boxed);
    expect(shadow?.color).toBe(mixHex("#3b2a20", GREY_HAIR, 0.5));
    expect(groomingShape(boxed)).toEqual({ browScale: 1, beardReach: 0.35 });
    expect(groomingShape({ facialHair: { ...boxedHair, style: "stubble" } }).beardReach).toBe(0);
    expect(groomingShape(undefined)).toBe(NATURAL_SHAPE);
  });

  it("adds brow strands for fuller brows using the best colour available", () => {
    const brow = (grooming: Grooming, browColor?: string) =>
      makeupPasses(browColor === undefined ? undefined : { brows: { color: browColor, opacity: 0.4 } }, grooming).find(
        (pass) => pass.region === "brows",
      )?.color;
    expect(brow({ brows: "fuller" }, "#4e342e")).toBe("#4e342e");
    expect(brow({ ...boxed, brows: "fuller" })).toBe("#3b2a20");
    expect(brow({ brows: "fuller" })).toBe("#3b2a20");
    expect(groomingShape({ brows: "fuller" }).browScale).toBe(1.3);
  });
});

describe("hair texture", () => {
  it("is deterministic for a seed", () => {
    expect(hairTilePixels(hairTexture, seededRandom(7))).toEqual(hairTilePixels(hairTexture, seededRandom(7)));
  });

  it("covers more of the tile as density rises", () => {
    const share = (density: number) => opaqueShare(hairTilePixels({ ...hairTexture, density }, seededRandom(1)));
    expect(share(0)).toBe(0);
    expect(share(0.3)).toBeLessThan(share(0.9));
    expect(share(1)).toBeLessThan(1);
  });

  it("mixes in grey strands for salt and pepper", () => {
    const greyPixels = (grey: number) => {
      const pixels = hairTilePixels({ ...hairTexture, color: "#000000", grey }, seededRandom(3));
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        count += (pixels[i + 3] ?? 0) > 0 && (pixels[i] ?? 0) > 100 ? 1 : 0;
      }
      return count;
    };
    expect(greyPixels(0)).toBe(0);
    expect(greyPixels(0.5)).toBeGreaterThan(0);
    expect(greyPixels(1)).toBeGreaterThan(greyPixels(0.5));
  });

  it("anchors and scales the pattern to the face, within limits", () => {
    const out = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    expect(writePatternTransform(out, 10, 20, 160)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    expect(writePatternTransform(out, 0, 0, 10_000).a).toBe(2);
    expect(writePatternTransform(out, 0, 0, 0).a).toBe(0.35);
  });

  it("builds each pattern once", () => {
    let tiles = 0;
    const target = { createPattern: () => ({ setTransform: () => {} }) as unknown as CanvasPattern };
    const patterns = createHairPatterns(target, () => {
      tiles += 1;
      return null;
    });
    expect(patterns.get(hairTexture)).toBeNull();
    patterns.get(hairTexture);
    patterns.get({ ...hairTexture, grey: 0.5 });
    expect(tiles).toBe(2);
  });
});

describe("painting textured passes", () => {
  function context() {
    const fills: string[] = [];
    const ctx = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      fillStyle: "#000" as string | CanvasPattern,
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      ellipse: () => {},
      fill: () => fills.push(typeof ctx.fillStyle === "string" ? ctx.fillStyle : "pattern"),
    };
    return { ctx: ctx as unknown as PaintContext, fills };
  }

  it("fills strand passes with a face-anchored pattern and skips them without one", () => {
    const transforms: DOMMatrix2DInit[] = [];
    const pattern = { setTransform: (m: DOMMatrix2DInit) => transforms.push({ ...m }) } as unknown as CanvasPattern;
    const geometry = writeMakeupGeometry(createMakeupGeometry(), face(), 640, 480);
    const passes = makeupPasses(undefined, { facialHair: { style: "mustache", length: 0, density: 0.6, color: "#222222", grey: 0 } });
    const withHair = context();
    createMakeupPainter(withHair.ctx, null, { get: () => pattern }).paint({} as CanvasImageSource, geometry, passes, 640, 480);
    expect(withHair.fills).toEqual(["#222222", "pattern"]);
    expect(transforms[0]?.e).toBe(geometry.chin[0]);
    const without = context();
    createMakeupPainter(without.ctx, null, null).paint({} as CanvasImageSource, geometry, passes, 640, 480);
    expect(without.fills).toEqual(["#222222"]);
  });
});
