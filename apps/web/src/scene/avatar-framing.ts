export interface ModelBounds {
  minY: number;
  maxY: number;
  centerX: number;
  centerZ: number;
  depth: number;
}

export interface CameraFrame {
  x: number;
  y: number;
  z: number;
  lookY: number;
  near: number;
  far: number;
}

// A webcam bust: the head fills about a third of the frame, with its centre a little above the middle.
export const HEAD_SHARE = 1 / 3;
export const FACE_FROM_TOP = 0.4;
const BUST_SHARE = 0.42;
const HEAD_ROOM = 0.05;
const MAX_HEAD_SHARE_OF_BODY = 0.4;

function place(bounds: ModelBounds, visible: number, lookY: number, fovDeg: number, x: number): CameraFrame {
  const distance = visible / 2 / Math.tan((fovDeg * Math.PI) / 360) + bounds.depth / 2;
  return { x, y: lookY, z: bounds.centerZ + distance, lookY, near: Math.max(0.01, distance / 100), far: distance * 10 };
}

// headY is the head bone, which rigs put at the base of the skull; without a usable one, frame the top of the body.
export function frameBust(bounds: ModelBounds, head: { x: number; y: number } | null, fovDeg: number): CameraFrame {
  const height = bounds.maxY - bounds.minY;
  const headHeight = head === null ? 0 : bounds.maxY - head.y;
  if (head !== null && headHeight > 0 && headHeight <= height * MAX_HEAD_SHARE_OF_BODY) {
    const visible = headHeight / HEAD_SHARE;
    const faceY = head.y + headHeight / 2;
    return place(bounds, visible, faceY - visible * (0.5 - FACE_FROM_TOP), fovDeg, head.x);
  }
  const visible = Math.max(height, 0.01) * BUST_SHARE;
  return place(bounds, visible, bounds.maxY + height * HEAD_ROOM - visible / 2, fovDeg, bounds.centerX);
}
