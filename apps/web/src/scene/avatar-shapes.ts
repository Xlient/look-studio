import type { Box, FaceAnchors, Point } from "./avatar-face-anchors.ts";

export const FACE_SHAPES = ["smile", "browRaise", "jawOpen", "squintLeft", "squintRight"] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

const GRID = 96;
// Sparse vertices leave gaps, and a patch resting on the highest nearby point stays clear of the curved surface.
const HEIGHT_REACH = 2;
const FRONT_TOLERANCE = 0.15;
const SMILE = { radius: 0.42, up: 0.1, out: 0.05 } as const;
const BROW = { radius: 0.4, up: 0.09 } as const;
const JAW = { radius: 0.6, down: 0.2 } as const;
const SQUINT = { squeeze: 0.32, radius: 0.85 } as const;

export interface HeightField {
  sample(x: number, y: number): number | null;
}

export function buildHeightField(positions: Float32Array, weights: Float32Array): HeightField {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < weights.length; i += 1) {
    if ((weights[i] ?? 0) >= 0.5) {
      const x = positions[i * 3] ?? 0;
      const y = positions[i * 3 + 1] ?? 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const cells = new Float32Array(GRID * GRID).fill(Number.NEGATIVE_INFINITY);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const column = (x: number) => Math.floor(((x - minX) / spanX) * (GRID - 1));
  const row = (y: number) => Math.floor(((y - minY) / spanY) * (GRID - 1));
  for (let i = 0; i < weights.length; i += 1) {
    if ((weights[i] ?? 0) >= 0.5) {
      const key = row(positions[i * 3 + 1] ?? 0) * GRID + column(positions[i * 3] ?? 0);
      cells[key] = Math.max(cells[key] ?? Number.NEGATIVE_INFINITY, positions[i * 3 + 2] ?? 0);
    }
  }
  return {
    sample(x, y) {
      const c = column(x);
      const r = row(y);
      if (!(c >= 0 && c < GRID && r >= 0 && r < GRID)) {
        return null;
      }
      let best = Number.NEGATIVE_INFINITY;
      for (let dr = Math.max(0, r - HEIGHT_REACH); dr <= Math.min(GRID - 1, r + HEIGHT_REACH); dr += 1) {
        for (let dc = Math.max(0, c - HEIGHT_REACH); dc <= Math.min(GRID - 1, c + HEIGHT_REACH); dc += 1) {
          best = Math.max(best, cells[dr * GRID + dc] ?? Number.NEGATIVE_INFINITY);
        }
      }
      return best === Number.NEGATIVE_INFINITY ? null : best;
    },
  };
}

const boxCenter = (box: Box): Point => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
export const eyeSpacing = (anchors: FaceAnchors) => Math.abs(boxCenter(anchors.eyeRight).x - boxCenter(anchors.eyeLeft).x);

const falloff = (distance: number, radius: number) => {
  const t = 1 - Math.min(1, distance / radius);
  return t * t * (3 - 2 * t);
};

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

function squintDelta(out: Float32Array, i: number, x: number, y: number, eye: Box, weight: number) {
  const center = boxCenter(eye);
  const rx = ((eye.maxX - eye.minX) / 2) * (1 + SQUINT.radius);
  const ry = ((eye.maxY - eye.minY) / 2) * (1 + SQUINT.radius);
  const amount = falloff(Math.hypot((x - center.x) / rx, (y - center.y) / ry), 1);
  out[i * 3 + 1] = (center.y - y) * SQUINT.squeeze * amount * weight;
}

// Every shape is a world-space offset per vertex; weights keep it on the head and off the scarf and collar.
export function buildFaceShapes(positions: Float32Array, weights: Float32Array, anchors: FaceAnchors, height: HeightField): Record<FaceShape, Float32Array> {
  const spacing = eyeSpacing(anchors);
  const shapes: Record<FaceShape, Float32Array> = {
    smile: new Float32Array(positions.length),
    browRaise: new Float32Array(positions.length),
    jawOpen: new Float32Array(positions.length),
    squintLeft: new Float32Array(positions.length),
    squintRight: new Float32Array(positions.length),
  };
  const mouthY = (anchors.mouthTop.y + anchors.mouthBottom.y) / 2;
  const mouthX = (anchors.mouthLeft.x + anchors.mouthRight.x) / 2;
  const eyeTop = Math.max(anchors.eyeLeft.maxY, anchors.eyeRight.maxY);
  const browY = Math.min(anchors.browLeft.y, anchors.browRight.y);
  for (let i = 0; i < weights.length; i += 1) {
    const weight = weights[i] ?? 0;
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const surface = height.sample(x, y);
    if (weight <= 0 || surface === null || (positions[i * 3 + 2] ?? 0) < surface - spacing * FRONT_TOLERANCE) {
      continue;
    }
    const smileLeft = falloff(Math.hypot(x - anchors.mouthLeft.x, y - anchors.mouthLeft.y), spacing * SMILE.radius);
    const smileRight = falloff(Math.hypot(x - anchors.mouthRight.x, y - anchors.mouthRight.y), spacing * SMILE.radius);
    shapes.smile[i * 3] = (smileRight - smileLeft) * spacing * SMILE.out * weight;
    shapes.smile[i * 3 + 1] = Math.max(smileLeft, smileRight) * spacing * SMILE.up * weight;

    const brow = Math.max(
      falloff(Math.hypot(x - anchors.browLeft.x, y - anchors.browLeft.y), spacing * BROW.radius),
      falloff(Math.hypot(x - anchors.browRight.x, y - anchors.browRight.y), spacing * BROW.radius),
    );
    shapes.browRaise[i * 3 + 1] = brow * ramp(y, eyeTop, browY) * spacing * BROW.up * weight;

    const below = ramp(mouthY - y, 0, Math.max(mouthY - anchors.chin.y, 1e-6));
    shapes.jawOpen[i * 3 + 1] = -below * falloff(Math.abs(x - mouthX), spacing * JAW.radius * 1.4) * spacing * JAW.down * weight;

    squintDelta(shapes.squintLeft, i, x, y, anchors.eyeLeft, weight);
    squintDelta(shapes.squintRight, i, x, y, anchors.eyeRight, weight);
  }
  return shapes;
}
