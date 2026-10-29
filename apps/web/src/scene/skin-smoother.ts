import type { MakeupGeometry, Polygon } from "./makeup-regions.ts";

const LAYER_SCALE = 0.5;
const MAX_MIX = 0.75;
const MIN_STRENGTH = 0.01;
const BLUR_RATIO = 0.04;
const FEATHER_RATIO = 0.1;
const MARGIN_RATIO = 0.3;

export interface TouchUpSettings {
  alpha: number;
  blurPx: number;
  featherPx: number;
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

export function touchUpSettings(strength: number, eyeDistance: number): TouchUpSettings | null {
  if (!Number.isFinite(strength) || strength < MIN_STRENGTH || eyeDistance <= 0) {
    return null;
  }
  const level = Math.min(1, strength);
  return { alpha: level * MAX_MIX, blurPx: eyeDistance * BLUR_RATIO, featherPx: eyeDistance * FEATHER_RATIO };
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

export function createSkinSmoother(createLayer: () => SmoothLayer | null) {
  const mask = createLayer();
  const blurred = createLayer();
  const bounds: Bounds = { x: 0, y: 0, w: 0, h: 0 };
  const filters = new Map<number, string>();
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

  const drawMask = (ctx: CanvasRenderingContext2D, geometry: MakeupGeometry, settings: TouchUpSettings) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);
    ctx.filter = blur(settings.featherPx);
    ctx.fillStyle = "#fff";
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    trace(ctx, geometry.faceOval);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.filter = blur(settings.featherPx / 2);
    ctx.beginPath();
    trace(ctx, geometry.rightEye);
    trace(ctx, geometry.leftEye);
    trace(ctx, geometry.rightBrow);
    trace(ctx, geometry.leftBrow);
    trace(ctx, geometry.lipsOuter);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
  };

  const drawBlurred = (ctx: CanvasRenderingContext2D, source: CanvasImageSource, area: Bounds, settings: TouchUpSettings, maskCanvas: HTMLCanvasElement) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = blur(settings.blurPx);
    const s = LAYER_SCALE;
    ctx.drawImage(source, area.x, area.y, area.w, area.h, area.x * s, area.y * s, area.w * s, area.h * s);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  };

  return {
    apply(target: SmoothTarget, source: CanvasImageSource, geometry: MakeupGeometry, strength: number, width: number, height: number) {
      const settings = touchUpSettings(strength, geometry.eyeDistance);
      if (settings === null || mask === null || blurred === null || !geometry.visible) {
        return;
      }
      const area = writeFaceBounds(bounds, geometry.faceOval, geometry.eyeDistance * MARGIN_RATIO, width, height);
      if (area === null) {
        return;
      }
      resize(mask, width, height);
      resize(blurred, width, height);
      drawMask(mask.ctx, geometry, settings);
      drawBlurred(blurred.ctx, source, area, settings, mask.canvas);
      target.save();
      target.globalCompositeOperation = "source-over";
      target.globalAlpha = settings.alpha;
      target.filter = "none";
      target.drawImage(blurred.canvas, 0, 0, blurred.canvas.width, blurred.canvas.height, 0, 0, width, height);
      target.restore();
    },
  };
}
