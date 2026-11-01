export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type FrameMode = "head" | "body";

export interface CameraFrame {
  mode: FrameMode;
  x: number;
  y: number;
  z: number;
  lookY: number;
  lookZ: number;
  near: number;
  far: number;
}

// A webcam bust: the head fills about a third of the frame, with its centre a little above the middle.
export const HEAD_SHARE = 1 / 3;
export const FACE_FROM_TOP = 0.4;
const BUST_SHARE = 0.42;
const HEAD_ROOM = 0.05;

function place(mode: FrameMode, box: Bounds, visible: number, lookY: number, fovDeg: number): CameraFrame {
  const centerZ = (box.minZ + box.maxZ) / 2;
  const distance = visible / 2 / Math.tan((fovDeg * Math.PI) / 360) + (box.maxZ - box.minZ) / 2;
  return {
    mode,
    x: (box.minX + box.maxX) / 2,
    y: lookY,
    z: centerZ + distance,
    lookY,
    lookZ: centerZ,
    near: Math.max(0.01, distance / 100),
    far: distance * 10,
  };
}

// head holds the vertices skinned to the head bone; the whole-model box can include stray geometry, so it is only a fallback.
export function frameBust(body: Bounds, head: Bounds | null, fovDeg: number): CameraFrame {
  const headHeight = head === null ? 0 : head.maxY - head.minY;
  if (head !== null && headHeight > 0 && Number.isFinite(headHeight)) {
    const visible = headHeight / HEAD_SHARE;
    const faceY = (head.minY + head.maxY) / 2;
    return place("head", head, visible, faceY - visible * (0.5 - FACE_FROM_TOP), fovDeg);
  }
  const height = Math.max(body.maxY - body.minY, 0.01);
  const visible = height * BUST_SHARE;
  return place("body", body, visible, body.maxY + height * HEAD_ROOM - visible / 2, fovDeg);
}
