import type { HeadState } from "../tracking/head-state.ts";
import { eyeDistancePx } from "./head-anchor.ts";

const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const RIGHT_LID = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const LEFT_LID = [263, 466, 388, 387, 386, 385, 384, 398, 362];
const RIGHT_BROW_UPPER = [70, 63, 105, 66, 107];
const RIGHT_BROW_LOWER = [46, 53, 52, 65, 55];
const LEFT_BROW_UPPER = [300, 293, 334, 296, 336];
const LEFT_BROW_LOWER = [276, 283, 282, 295, 285];
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const MUSTACHE = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 410, 322, 391, 393, 2, 167, 165, 92, 186];
const GOATEE = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 287, 377, 152, 148, 57];
const GOATEE_CHIN = { from: 12, to: 15 } as const;
const BEARD = [
  127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 376, 411, 287,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 57, 187, 147,
];
const BEARD_JAW_POINTS = 23;
const NOSE_TIP = 1;
const CHIN = 152;
const RIGHT_CHEEK = 50;
const LEFT_CHEEK = 280;
const LOWER_LIP_CENTER = 17;
const INNER_LOWER_LIP = 14;

const SHADOW_REACH = 0.55;

export interface GeometryShape {
  browScale: number;
  beardReach: number;
}

export const NATURAL_SHAPE: GeometryShape = { browScale: 1, beardReach: 0 };

export interface Polygon {
  readonly points: Float32Array;
  count: number;
}

export interface MakeupGeometry {
  lipsOuter: Polygon;
  lipsInner: Polygon;
  rightShadow: Polygon;
  leftShadow: Polygon;
  rightBrow: Polygon;
  leftBrow: Polygon;
  faceOval: Polygon;
  rightEye: Polygon;
  leftEye: Polygon;
  mustache: Polygon;
  goatee: Polygon;
  beard: Polygon;
  readonly chin: Float32Array;
  readonly cheeks: Float32Array;
  readonly glossCenter: Float32Array;
  eyeDistance: number;
  visible: boolean;
}

const polygon = (size: number): Polygon => ({ points: new Float32Array(size * 2), count: 0 });

export function createMakeupGeometry(): MakeupGeometry {
  return {
    lipsOuter: polygon(LIPS_OUTER.length),
    lipsInner: polygon(LIPS_INNER.length),
    rightShadow: polygon(RIGHT_LID.length + RIGHT_BROW_LOWER.length),
    leftShadow: polygon(LEFT_LID.length + LEFT_BROW_LOWER.length),
    rightBrow: polygon(RIGHT_BROW_UPPER.length + RIGHT_BROW_LOWER.length),
    leftBrow: polygon(LEFT_BROW_UPPER.length + LEFT_BROW_LOWER.length),
    faceOval: polygon(FACE_OVAL.length),
    rightEye: polygon(RIGHT_EYE.length),
    leftEye: polygon(LEFT_EYE.length),
    mustache: polygon(MUSTACHE.length),
    goatee: polygon(GOATEE.length),
    beard: polygon(BEARD.length),
    chin: new Float32Array(2),
    cheeks: new Float32Array(4),
    glossCenter: new Float32Array(2),
    eyeDistance: 0,
    visible: false,
  };
}

const px = (state: HeadState, index: number, width: number) => (state.landmarks[index * 3] ?? 0) * width;
const py = (state: HeadState, index: number, height: number) => (state.landmarks[index * 3 + 1] ?? 0) * height;

function push(target: Polygon, x: number, y: number) {
  target.points[target.count * 2] = x;
  target.points[target.count * 2 + 1] = y;
  target.count += 1;
}

function writeLoop(target: Polygon, state: HeadState, indices: readonly number[], w: number, h: number, reverse = false) {
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[reverse ? indices.length - 1 - i : i] ?? 0;
    push(target, px(state, index, w), py(state, index, h));
  }
}

function writeShadow(target: Polygon, state: HeadState, lid: readonly number[], brow: readonly number[], w: number, h: number) {
  target.count = 0;
  writeLoop(target, state, lid, w, h);
  for (let j = brow.length - 1; j >= 0; j -= 1) {
    const lidIndex = lid[Math.round((j / (brow.length - 1)) * (lid.length - 1))] ?? 0;
    const browIndex = brow[j] ?? 0;
    const lx = px(state, lidIndex, w);
    const ly = py(state, lidIndex, h);
    push(target, lx + (px(state, browIndex, w) - lx) * SHADOW_REACH, ly + (py(state, browIndex, h) - ly) * SHADOW_REACH);
  }
}

function writeBrow(target: Polygon, state: HeadState, upper: readonly number[], lower: readonly number[], w: number, h: number) {
  target.count = 0;
  writeLoop(target, state, upper, w, h);
  writeLoop(target, state, lower, w, h, true);
}

// Scales each upper/lower brow pair about its midpoint, so "fuller" thickens and "tidy" slims the same arch.
function scaleBrow(target: Polygon, scale: number) {
  const pairs = target.count / 2;
  for (let i = 0; i < pairs; i += 1) {
    const j = target.count - 1 - i;
    const mx = ((target.points[i * 2] ?? 0) + (target.points[j * 2] ?? 0)) / 2;
    const my = ((target.points[i * 2 + 1] ?? 0) + (target.points[j * 2 + 1] ?? 0)) / 2;
    scalePoint(target, i, mx, my, scale);
    scalePoint(target, j, mx, my, scale);
  }
}

function scalePoint(target: Polygon, k: number, mx: number, my: number, scale: number) {
  target.points[k * 2] = mx + ((target.points[k * 2] ?? 0) - mx) * scale;
  target.points[k * 2 + 1] = my + ((target.points[k * 2 + 1] ?? 0) - my) * scale;
}

function pushFromNose(target: Polygon, from: number, to: number, noseX: number, noseY: number, reach: number) {
  for (let i = from; i < to; i += 1) {
    const dx = (target.points[i * 2] ?? 0) - noseX;
    const dy = (target.points[i * 2 + 1] ?? 0) - noseY;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      target.points[i * 2] = (target.points[i * 2] ?? 0) + (dx / length) * reach;
      target.points[i * 2 + 1] = (target.points[i * 2 + 1] ?? 0) + (dy / length) * reach;
    }
  }
}

export function writeMakeupGeometry(
  out: MakeupGeometry,
  state: HeadState | null,
  width: number,
  height: number,
  shape: GeometryShape = NATURAL_SHAPE,
): MakeupGeometry {
  if (state === null || state.confidence < 0.5 || state.landmarkCount < 468) {
    out.visible = false;
    return out;
  }
  out.lipsOuter.count = 0;
  writeLoop(out.lipsOuter, state, LIPS_OUTER, width, height);
  out.lipsInner.count = 0;
  writeLoop(out.lipsInner, state, LIPS_INNER, width, height);
  writeShadow(out.rightShadow, state, RIGHT_LID, RIGHT_BROW_LOWER, width, height);
  writeShadow(out.leftShadow, state, LEFT_LID, LEFT_BROW_LOWER, width, height);
  writeBrow(out.rightBrow, state, RIGHT_BROW_UPPER, RIGHT_BROW_LOWER, width, height);
  writeBrow(out.leftBrow, state, LEFT_BROW_UPPER, LEFT_BROW_LOWER, width, height);
  if (shape.browScale !== 1) {
    scaleBrow(out.rightBrow, shape.browScale);
    scaleBrow(out.leftBrow, shape.browScale);
  }
  out.faceOval.count = 0;
  writeLoop(out.faceOval, state, FACE_OVAL, width, height);
  out.rightEye.count = 0;
  writeLoop(out.rightEye, state, RIGHT_EYE, width, height);
  out.leftEye.count = 0;
  writeLoop(out.leftEye, state, LEFT_EYE, width, height);
  out.cheeks[0] = px(state, RIGHT_CHEEK, width);
  out.cheeks[1] = py(state, RIGHT_CHEEK, height);
  out.cheeks[2] = px(state, LEFT_CHEEK, width);
  out.cheeks[3] = py(state, LEFT_CHEEK, height);
  out.glossCenter[0] = (px(state, LOWER_LIP_CENTER, width) + px(state, INNER_LOWER_LIP, width)) / 2;
  out.glossCenter[1] = (py(state, LOWER_LIP_CENTER, height) + py(state, INNER_LOWER_LIP, height)) / 2;
  out.eyeDistance = eyeDistancePx(state, width);
  out.mustache.count = 0;
  writeLoop(out.mustache, state, MUSTACHE, width, height);
  out.goatee.count = 0;
  writeLoop(out.goatee, state, GOATEE, width, height);
  out.beard.count = 0;
  writeLoop(out.beard, state, BEARD, width, height);
  if (shape.beardReach > 0) {
    const reach = shape.beardReach * out.eyeDistance;
    const noseX = px(state, NOSE_TIP, width);
    const noseY = py(state, NOSE_TIP, height);
    pushFromNose(out.beard, 0, BEARD_JAW_POINTS, noseX, noseY, reach);
    pushFromNose(out.goatee, GOATEE_CHIN.from, GOATEE_CHIN.to, noseX, noseY, reach);
  }
  out.chin[0] = px(state, CHIN, width);
  out.chin[1] = py(state, CHIN, height);
  out.visible = true;
  return out;
}
