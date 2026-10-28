import type { HeadState } from "../tracking/head-state.ts";

export const FOREHEAD = 10;
export const RIGHT_EYE_OUTER = 33;
export const LEFT_EYE_OUTER = 263;

const CROWN_LIFT = 0.45;
const MIN_CONFIDENCE = 0.5;

export interface HeadAnchor {
  visible: boolean;
  x: number;
  y: number;
  scale: number;
  readonly rotation: Float32Array;
}

export interface Viewport {
  width: number;
  height: number;
  mirror: boolean;
}

export function createHeadAnchor(): HeadAnchor {
  const rotation = new Float32Array(16);
  rotation[0] = rotation[5] = rotation[10] = rotation[15] = 1;
  return { visible: false, x: 0, y: 0, scale: 1, rotation };
}

const point = (state: HeadState, index: number, axis: number) => state.landmarks[index * 3 + axis] ?? 0;

export function eyeDistancePx(state: HeadState, width: number): number {
  const dx = (point(state, LEFT_EYE_OUTER, 0) - point(state, RIGHT_EYE_OUTER, 0)) * width;
  const dy = (point(state, LEFT_EYE_OUTER, 1) - point(state, RIGHT_EYE_OUTER, 1)) * width;
  const dz = (point(state, LEFT_EYE_OUTER, 2) - point(state, RIGHT_EYE_OUTER, 2)) * width;
  return Math.hypot(dx, dy, dz);
}

export function writeHeadAnchor(out: HeadAnchor, state: HeadState | null, view: Viewport): HeadAnchor {
  if (state === null || state.confidence < MIN_CONFIDENCE || state.landmarkCount <= LEFT_EYE_OUTER) {
    out.visible = false;
    return out;
  }
  const flip = view.mirror ? -1 : 1;
  const pose = state.pose;
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      const sign = (row === 0) !== (col === 0) ? flip : 1;
      out.rotation[col * 4 + row] = sign * (pose[col * 4 + row] ?? 0);
    }
  }
  const distance = eyeDistancePx(state, view.width);
  const upX = out.rotation[4] ?? 0;
  const upY = out.rotation[5] ?? 1;
  out.x = flip * (point(state, FOREHEAD, 0) - 0.5) * view.width + upX * distance * CROWN_LIFT;
  out.y = (0.5 - point(state, FOREHEAD, 1)) * view.height + upY * distance * CROWN_LIFT;
  out.scale = distance;
  out.visible = true;
  return out;
}

export function createFrameGate(fps: number) {
  const interval = 1000 / fps;
  let last = Number.NEGATIVE_INFINITY;
  return (tMs: number): boolean => {
    if (tMs - last < interval - 1) {
      return false;
    }
    last = tMs;
    return true;
  };
}
