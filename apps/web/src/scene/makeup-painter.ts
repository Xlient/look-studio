import type { MakeupGeometry, Polygon } from "./makeup-regions.ts";
import { featherPx } from "./makeup-style.ts";
import type { MakeupPass } from "./makeup-style.ts";
import { NO_SKIN } from "./skin-smoother.ts";
import type { SkinRender, SkinSmoother } from "./skin-smoother.ts";
import { writePatternTransform } from "./hair-texture.ts";
import type { HairPatterns, PatternTransform } from "./hair-texture.ts";

export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "drawImage"
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "ellipse"
  | "fill"
  | "globalAlpha"
  | "globalCompositeOperation"
  | "filter"
  | "fillStyle"
>;

const BLUSH_RADIUS = 0.32;
const GLOSS_RADIUS = 0.14;

export function createMakeupPainter(ctx: PaintContext, smoother: SkinSmoother | null = null, hair: HairPatterns | null = null) {
  const patternTransform: PatternTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const blurFilters = new Map<number, string>();
  const blur = (px: number) => {
    let filter = blurFilters.get(px);
    if (filter === undefined) {
      filter = `blur(${px}px)`;
      blurFilters.set(px, filter);
    }
    return filter;
  };

  const trace = (shape: Polygon) => {
    for (let i = 0; i < shape.count; i += 1) {
      const x = shape.points[i * 2] ?? 0;
      const y = shape.points[i * 2 + 1] ?? 0;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  };

  const circle = (x: number, y: number, rx: number, ry: number) => {
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  };

  const traceRegion = (pass: MakeupPass, geometry: MakeupGeometry) => {
    const d = geometry.eyeDistance;
    switch (pass.region) {
      case "lips":
        trace(geometry.lipsOuter);
        trace(geometry.lipsInner);
        return;
      case "gloss":
        circle(geometry.glossCenter[0] ?? 0, geometry.glossCenter[1] ?? 0, d * GLOSS_RADIUS, d * GLOSS_RADIUS * 0.4);
        return;
      case "blush":
        circle(geometry.cheeks[0] ?? 0, geometry.cheeks[1] ?? 0, d * BLUSH_RADIUS, d * BLUSH_RADIUS * 0.75);
        circle(geometry.cheeks[2] ?? 0, geometry.cheeks[3] ?? 0, d * BLUSH_RADIUS, d * BLUSH_RADIUS * 0.75);
        return;
      case "eyeshadow":
        trace(geometry.rightShadow);
        trace(geometry.leftShadow);
        return;
      case "brows":
        trace(geometry.rightBrow);
        trace(geometry.leftBrow);
        return;
      case "mustache":
        trace(geometry.mustache);
        return;
      case "goatee":
        trace(geometry.goatee);
        return;
      case "beard":
        trace(geometry.beard);
        return;
    }
  };

  return {
    paint(
      source: CanvasImageSource,
      geometry: MakeupGeometry,
      passes: readonly MakeupPass[],
      width: number,
      height: number,
      skin: SkinRender = NO_SKIN,
    ) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.drawImage(source, 0, 0, width, height);
      if (!geometry.visible) {
        return;
      }
      smoother?.apply(ctx, source, geometry, skin, width, height);
      for (const pass of passes) {
        ctx.save();
        ctx.globalCompositeOperation = pass.op;
        ctx.globalAlpha = pass.alpha;
        ctx.filter = blur(featherPx(pass, geometry.eyeDistance));
        if (pass.texture === undefined) {
          ctx.fillStyle = pass.color;
        } else {
          const pattern = hair?.get(pass.texture) ?? null;
          if (pattern === null) {
            ctx.restore();
            continue;
          }
          pattern.setTransform(writePatternTransform(patternTransform, geometry.chin[0] ?? 0, geometry.chin[1] ?? 0, geometry.eyeDistance));
          ctx.fillStyle = pattern;
        }
        ctx.beginPath();
        traceRegion(pass, geometry);
        ctx.fill("evenodd");
        ctx.restore();
      }
    },
  };
}
