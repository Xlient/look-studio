import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import type { Object3D } from "three";
import { EXPRESSION } from "../tracking/expressions.ts";
import type { Box, FaceAnchors, Rgb } from "./avatar-face-anchors.ts";
import { eyeSpacing } from "./avatar-shapes.ts";
import type { HeightField } from "./avatar-shapes.ts";

const CANVAS_SIZE = 128;
const SEGMENTS = 10;
const SURFACE_LIFT = 0.03;
const EYE_PADDING = 1.25;
const LID_OVERLAP = 0.16;
const LID_FADE_START = 0.84;
const STEPS = 24;
const LASH = "#2b1a14";
const IRIS = "#2d1c14";
const MOUTH_DARK = "#4d1620";
const TONGUE = "#c9545c";

export type FaceLayerMode = "overlay" | "drawn";

export interface FaceLayer {
  update(expressions: Float32Array): void;
}

const css = (color: Rgb) => `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;

// Blink 0 draws nothing in overlay mode, so the model's painted eye shows through.
export function drawEye(ctx: CanvasRenderingContext2D, size: number, blink: number, mode: FaceLayerMode, skin: Rgb) {
  ctx.clearRect(0, 0, size, size);
  const center = size / 2;
  const radius = (size / 2 / EYE_PADDING) * (1 + LID_OVERLAP);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(center, center, radius, radius, 0, 0, Math.PI * 2);
  ctx.clip();
  if (mode === "drawn") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = IRIS;
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(center + radius * 0.2, center - radius * 0.25, radius * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  const edge = center - radius + blink * radius * 2;
  if (blink > 0) {
    ctx.fillStyle = css(skin);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, 0);
    ctx.lineTo(size, edge - radius * 0.25 * (1 - blink));
    ctx.quadraticCurveTo(center, edge + radius * 0.25 * (1 - blink), 0, edge - radius * 0.25 * (1 - blink));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  if (mode === "overlay" && blink > 0) {
    // Fading the rim outside the painted eye hides the seam against the model's shaded skin.
    const fade = ctx.createRadialGradient(center, center, radius * LID_FADE_START, center, center, radius);
    fade.addColorStop(0, "rgb(0 0 0 / 1)");
    fade.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  }
  if (blink > 0) {
    ctx.strokeStyle = LASH;
    ctx.lineWidth = size * 0.05;
    ctx.lineCap = "round";
    ctx.beginPath();
    const side = radius * Math.sqrt(Math.max(0, 1 - ((edge - center) / radius) ** 2));
    ctx.moveTo(center - Math.max(side, radius * 0.75), Math.min(edge, center + radius * 0.92));
    ctx.quadraticCurveTo(center, Math.min(edge + radius * 0.2, size), center + Math.max(side, radius * 0.75), Math.min(edge, center + radius * 0.92));
    ctx.stroke();
  }
}

// The mouth plane is twice the mouth's width, centred under the top lip so the jaw can open downward.
export function drawMouth(ctx: CanvasRenderingContext2D, size: number, jaw: number, smile: number, mode: FaceLayerMode) {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const top = size * 0.4;
  const halfWidth = size * 0.25 * (1 - jaw * 0.15 + smile * 0.1);
  if (jaw > 0) {
    const depth = size * 0.05 + jaw * size * 0.3;
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, top + depth / 2, halfWidth, depth / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(cx, top + depth, halfWidth * 0.7, depth * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (mode === "drawn") {
    ctx.strokeStyle = MOUTH_DARK;
    ctx.lineWidth = size * 0.03;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, top);
    ctx.quadraticCurveTo(cx, top + size * 0.04 + smile * size * 0.14, cx + halfWidth, top);
    ctx.stroke();
  }
}

interface Patch {
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  mesh: Mesh;
}

function createPatch(parent: Object3D, box: Box, height: HeightField, lift: number): Patch | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return null;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const geometry = new PlaneGeometry(box.maxX - box.minX, box.maxY - box.minY, SEGMENTS, SEGMENTS);
  const position = geometry.getAttribute("position");
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  let lastZ = 0;
  for (let i = 0; i < position.count; i += 1) {
    const x = cx + position.getX(i);
    const y = cy + position.getY(i);
    lastZ = height.sample(x, y) ?? lastZ;
    position.setXYZ(i, x, y, lastZ + lift);
  }
  position.needsUpdate = true;
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { ctx, texture, mesh };
}

const padded = (box: Box, factor: number): Box => {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const hw = ((box.maxX - box.minX) / 2) * factor;
  const hh = ((box.maxY - box.minY) / 2) * factor;
  return { minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh };
};

// parent holds the patches in world coordinates at the rest pose; the caller attaches it to the head bone.
export function createFaceLayer(parent: Object3D, anchors: FaceAnchors, height: HeightField, mode: FaceLayerMode): FaceLayer {
  const lift = eyeSpacing(anchors) * SURFACE_LIFT;
  const eyeLeft = createPatch(parent, padded(anchors.eyeLeft, EYE_PADDING), height, lift);
  const eyeRight = createPatch(parent, padded(anchors.eyeRight, EYE_PADDING), height, lift);
  const mouthWidth = anchors.mouthRight.x - anchors.mouthLeft.x;
  const mouthCx = (anchors.mouthLeft.x + anchors.mouthRight.x) / 2;
  const mouthBox: Box = {
    minX: mouthCx - mouthWidth,
    maxX: mouthCx + mouthWidth,
    maxY: anchors.mouthTop.y + mouthWidth * 2 * 0.4,
    minY: anchors.mouthTop.y - mouthWidth * 2 * 0.6,
  };
  const mouth = createPatch(parent, mouthBox, height, lift);
  let lastLeft = -1;
  let lastRight = -1;
  let lastMouth = -1;

  const refresh = (patch: Patch | null, key: number, last: number, draw: (ctx: CanvasRenderingContext2D) => void, visible: boolean) => {
    if (patch === null || key === last) {
      return key;
    }
    draw(patch.ctx);
    patch.texture.needsUpdate = true;
    patch.mesh.visible = visible;
    return key;
  };

  const quantize = (value: number) => Math.round(value * STEPS) / STEPS;

  return {
    update(expressions) {
      const left = quantize(expressions[EXPRESSION.blinkA] ?? 0);
      const right = quantize(expressions[EXPRESSION.blinkB] ?? 0);
      const jaw = quantize(expressions[EXPRESSION.jawOpen] ?? 0);
      const smile = quantize(expressions[EXPRESSION.smile] ?? 0);
      const drawn = mode === "drawn";
      lastLeft = refresh(eyeLeft, left, lastLeft, (ctx) => drawEye(ctx, CANVAS_SIZE, left, mode, anchors.lidLeft), drawn || left > 0);
      lastRight = refresh(eyeRight, right, lastRight, (ctx) => drawEye(ctx, CANVAS_SIZE, right, mode, anchors.lidRight), drawn || right > 0);
      lastMouth = refresh(mouth, jaw * 1000 + smile, lastMouth, (ctx) => drawMouth(ctx, CANVAS_SIZE, jaw, smile, mode), drawn || jaw > 0);
    },
  };
}
