import type { SkinCoverage, SkinFinish } from "@look-studio/shared";
import type { MakeupGeometry, Polygon } from "./makeup-regions.ts";

const LAYER_SCALE = 0.5;
const MAX_MIX = 0.75;
const MIN_STRENGTH = 0.01;
const BLUR_RATIO = 0.04;
const FEATHER_RATIO = 0.1;
const MARGIN_RATIO = 0.3;
const COVERAGE_ALPHA: Record<SkinCoverage, number> = { none: 0, sheer: 0.12, light: 0.2, medium: 0.3, full: 0.42 };
const DEWY_GLOW = 0.14;
const SAMPLE_EVERY_FRAMES = 30;
const SAMPLE_SIZE = 24;
const SAMPLE_MIN_ALPHA = 200;

export interface SkinRender {
  smoothing: number;
  coverage: SkinCoverage;
  finish: SkinFinish;
}

export const NO_SKIN: SkinRender = { smoothing: 0, coverage: "none", finish: "natural" };

export interface SmoothingSettings {
  alpha: number;
  blurPx: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SmoothLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export type SmoothTarget = Pick<
  CanvasRenderingContext2D,
  "drawImage" | "save" | "restore" | "globalAlpha" | "globalCompositeOperation" | "filter"
>;

export function smoothingSettings(strength: number, eyeDistance: number): SmoothingSettings | null {
  if (!Number.isFinite(strength) || strength < MIN_STRENGTH || eyeDistance <= 0) {
    return null;
  }
  return { alpha: Math.min(1, strength) * MAX_MIX, blurPx: eyeDistance * BLUR_RATIO };
}

export function coverageAlpha(coverage: SkinCoverage): number {
  return COVERAGE_ALPHA[coverage];
}

// Shade comes only from opaque mask pixels of the user's own face, never from a model or reference photo.
export function meanShade(rgba: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) >= SAMPLE_MIN_ALPHA) {
      r += rgba[i] ?? 0;
      g += rgba[i + 1] ?? 0;
      b += rgba[i + 2] ?? 0;
      count += 1;
    }
  }
  if (count === 0) {
    return null;
  }
  const hex = (sum: number) => Math.round(sum / count).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function writeFaceBounds(out: Bounds, oval: Polygon, margin: number, width: number, height: number): Bounds | null {
  if (oval.count === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < oval.count; i += 1) {
    const x = oval.points[i * 2] ?? 0;
    const y = oval.points[i * 2 + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  out.x = Math.max(0, Math.floor(minX - margin));
  out.y = Math.max(0, Math.floor(minY - margin));
  out.w = Math.min(width, Math.ceil(maxX + margin)) - out.x;
  out.h = Math.min(height, Math.ceil(maxY + margin)) - out.y;
  return out.w > 0 && out.h > 0 ? out : null;
}

function trace(ctx: CanvasRenderingContext2D, shape: Polygon) {
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
}

export type SkinSmoother = ReturnType<typeof createSkinSmoother>;

export function createSkinSmoother(createLayer: (readable: boolean) => SmoothLayer | null) {
  const mask = createLayer(false);
  const work = createLayer(false);
  const sample = createLayer(true);
  const bounds: Bounds = { x: 0, y: 0, w: 0, h: 0 };
  const filters = new Map<number, string>();
  let shade: string | null = null;
  let framesSinceSample = 0;
  const blur = (px: number) => {
    const rounded = Math.max(0.5, Math.round(px * LAYER_SCALE * 2) / 2);
    let filter = filters.get(rounded);
    if (filter === undefined) {
      filter = `blur(${rounded}px)`;
      filters.set(rounded, filter);
    }
    return filter;
  };

  const resize = (layer: SmoothLayer, width: number, height: number) => {
    const w = Math.ceil(width * LAYER_SCALE);
    const h = Math.ceil(height * LAYER_SCALE);
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w;
      layer.canvas.height = h;
    }
  };

  const drawMask = (ctx: CanvasRenderingContext2D, geometry: MakeupGeometry) => {
    const feather = geometry.eyeDistance * FEATHER_RATIO;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);
    ctx.filter = blur(feather);
    ctx.fillStyle = "#fff";
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    trace(ctx, geometry.faceOval);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.filter = blur(feather / 2);
    ctx.beginPath();
    trace(ctx, geometry.rightEye);
    trace(ctx, geometry.leftEye);
    trace(ctx, geometry.rightBrow);
    trace(ctx, geometry.leftBrow);
    trace(ctx, geometry.lipsOuter);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  const drawBlurred = (ctx: CanvasRenderingContext2D, source: CanvasImageSource, area: Bounds, blurPx: number, maskCanvas: HTMLCanvasElement) => {
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = blur(blurPx);
    const s = LAYER_SCALE;
    ctx.drawImage(source, area.x, area.y, area.w, area.h, area.x * s, area.y * s, area.w * s, area.h * s);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  };

  const fillMasked = (ctx: CanvasRenderingContext2D, color: string, maskCanvas: HTMLCanvasElement) => {
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  };

  const sampleShade = (layer: SmoothLayer, source: CanvasImageSource, area: Bounds, maskCanvas: HTMLCanvasElement) => {
    const ctx = layer.ctx;
    if (layer.canvas.width !== SAMPLE_SIZE) {
      layer.canvas.width = SAMPLE_SIZE;
      layer.canvas.height = SAMPLE_SIZE;
    }
    const s = LAYER_SCALE;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(source, area.x, area.y, area.w, area.h, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, area.x * s, area.y * s, area.w * s, area.h * s, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.globalCompositeOperation = "source-over";
    return meanShade(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  };

  const mix = (target: SmoothTarget, layer: SmoothLayer, alpha: number, op: GlobalCompositeOperation, width: number, height: number) => {
    target.save();
    target.globalCompositeOperation = op;
    target.globalAlpha = alpha;
    target.filter = "none";
    target.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, width, height);
    target.restore();
  };

  return {
    apply(target: SmoothTarget, source: CanvasImageSource, geometry: MakeupGeometry, skin: SkinRender, width: number, height: number) {
      if (!geometry.visible) {
        shade = null;
        return;
      }
      const smoothing = smoothingSettings(skin.smoothing, geometry.eyeDistance);
      const tint = coverageAlpha(skin.coverage);
      const glow = skin.finish === "dewy" ? DEWY_GLOW : 0;
      if ((smoothing === null && tint === 0 && glow === 0) || mask === null || work === null) {
        return;
      }
      const area = writeFaceBounds(bounds, geometry.faceOval, geometry.eyeDistance * MARGIN_RATIO, width, height);
      if (area === null) {
        return;
      }
      resize(mask, width, height);
      resize(work, width, height);
      drawMask(mask.ctx, geometry);
      if (smoothing !== null) {
        drawBlurred(work.ctx, source, area, smoothing.blurPx, mask.canvas);
        mix(target, work, smoothing.alpha, "source-over", width, height);
      }
      if (tint > 0 && sample !== null) {
        framesSinceSample += 1;
        if (shade === null || framesSinceSample >= SAMPLE_EVERY_FRAMES) {
          shade = sampleShade(sample, source, area, mask.canvas) ?? shade;
          framesSinceSample = 0;
        }
        if (shade !== null) {
          fillMasked(work.ctx, shade, mask.canvas);
          mix(target, work, tint, "source-over", width, height);
        }
      }
      if (glow > 0) {
        fillMasked(work.ctx, "#ffffff", mask.canvas);
        mix(target, work, glow, "soft-light", width, height);
      }
    },
  };
}
