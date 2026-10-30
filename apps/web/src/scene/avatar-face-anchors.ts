export interface Point {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Rgb = readonly [number, number, number];

// World-space XY of the facial features on the front of a model facing +Z; screen left is -X.
export interface FaceAnchors {
  eyeLeft: Box;
  eyeRight: Box;
  browLeft: Point;
  browRight: Point;
  mouthLeft: Point;
  mouthRight: Point;
  mouthTop: Point;
  mouthBottom: Point;
  chin: Point;
  lidLeft: Rgb;
  lidRight: Rgb;
}

export interface CaptureFrame {
  centerX: number;
  centerY: number;
  size: number;
}

export interface RgbaImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

const LANDMARK = {
  leftEye: [33, 133, 159, 145],
  rightEye: [362, 263, 386, 374],
  leftBrow: [70, 105],
  rightBrow: [336, 300],
  mouthLeft: 61,
  mouthRight: 291,
  mouthTop: 13,
  mouthBottom: 17,
  chin: 152,
  noseBridge: 6,
} as const;

const SKIN_DISTANCE = 42;
const MAX_EYE_MISMATCH = 1.3;
const LID_SAMPLE_GAP = 14;
const EYE_SEARCH_SHARE = 0.5;
const MIN_EYE_SHARE = 0.12;

const worldX = (frame: CaptureFrame, u: number) => frame.centerX + (u - 0.5) * frame.size;
const worldY = (frame: CaptureFrame, v: number) => frame.centerY + (0.5 - v) * frame.size;

function centroid(landmarks: readonly Point[], indices: readonly number[]): Point {
  let x = 0;
  let y = 0;
  for (const index of indices) {
    x += landmarks[index]?.x ?? 0;
    y += landmarks[index]?.y ?? 0;
  }
  return { x: x / indices.length, y: y / indices.length };
}

function averageColor(image: RgbaImage, cx: number, cy: number, radius: number): Rgb {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(image.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(image.width - 1, cx + radius); x += 1) {
      const at = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        sum[c] = (sum[c] ?? 0) + (image.data[at + c] ?? 0);
      }
      count += 1;
    }
  }
  return count === 0 ? [255, 220, 190] : [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}

// Tracker eye points suit human proportions; big painted eyes need their extent read from the pixels.
export function measureEye(image: RgbaImage, seedX: number, seedY: number, skin: Rgb, searchRadius: number): Box | null {
  const left = Math.max(0, seedX - searchRadius);
  const right = Math.min(image.width - 1, seedX + searchRadius);
  const top = Math.max(0, seedY - searchRadius);
  const bottom = Math.min(image.height - 1, seedY + searchRadius);
  const differs = (x: number, y: number) => {
    const at = (y * image.width + x) * 4;
    const distance =
      Math.abs((image.data[at] ?? 0) - skin[0]) + Math.abs((image.data[at + 1] ?? 0) - skin[1]) + Math.abs((image.data[at + 2] ?? 0) - skin[2]);
    return distance > SKIN_DISTANCE;
  };
  if (!differs(seedX, seedY)) {
    return null;
  }
  const seen = new Set<number>([seedY * image.width + seedX]);
  const stack: number[] = [seedX, seedY];
  const box = { minX: seedX, minY: seedY, maxX: seedX, maxY: seedY };
  while (stack.length > 0) {
    const y = stack.pop() ?? 0;
    const x = stack.pop() ?? 0;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      const key = ny * image.width + nx;
      if (nx >= left && nx <= right && ny >= top && ny <= bottom && !seen.has(key) && differs(nx, ny)) {
        seen.add(key);
        stack.push(nx, ny);
      }
    }
  }
  const leaked = box.minX === left || box.maxX === right || box.minY === top || box.maxY === bottom;
  const tiny = box.maxX - box.minX < searchRadius * MIN_EYE_SHARE || box.maxY - box.minY < searchRadius * MIN_EYE_SHARE;
  return leaked || tiny ? null : box;
}

function eyeBox(image: RgbaImage, frame: CaptureFrame, landmarks: readonly Point[], indices: readonly number[], skin: Rgb, eyeGap: number): Box {
  const center = centroid(landmarks, indices);
  const measured = measureEye(
    image,
    Math.round(center.x * image.width),
    Math.round(center.y * image.height),
    skin,
    Math.round(eyeGap * EYE_SEARCH_SHARE * image.width),
  );
  const us = indices.map((index) => landmarks[index]?.x ?? center.x);
  const vs = indices.map((index) => landmarks[index]?.y ?? center.y);
  const minU = measured === null ? Math.min(...us) : measured.minX / image.width;
  const maxU = measured === null ? Math.max(...us) : (measured.maxX + 1) / image.width;
  const minV = measured === null ? Math.min(...vs) : measured.minY / image.height;
  const maxV = measured === null ? Math.max(...vs) : (measured.maxY + 1) / image.height;
  return { minX: worldX(frame, minU), maxX: worldX(frame, maxU), minY: worldY(frame, maxV), maxY: worldY(frame, minV) };
}

const boxWidth = (box: Box) => box.maxX - box.minX;

// One side of a painted face can be shaded enough to mismeasure, and these eyes are symmetric, so trust the larger.
export function matchEyes(left: Box, right: Box, faceCenterX: number): { left: Box; right: Box } {
  const mirror = (box: Box): Box => ({ ...box, minX: 2 * faceCenterX - box.maxX, maxX: 2 * faceCenterX - box.minX });
  if (boxWidth(right) > boxWidth(left) * MAX_EYE_MISMATCH) {
    return { left: mirror(right), right };
  }
  if (boxWidth(left) > boxWidth(right) * MAX_EYE_MISMATCH) {
    return { left, right: mirror(left) };
  }
  return { left, right };
}

export function anchorsFromLandmarks(landmarks: readonly Point[], image: RgbaImage, frame: CaptureFrame): FaceAnchors {
  const world = (point: Point): Point => ({ x: worldX(frame, point.x), y: worldY(frame, point.y) });
  const at = (index: number) => world(landmarks[index] ?? { x: 0.5, y: 0.5 });
  const bridge = landmarks[LANDMARK.noseBridge] ?? { x: 0.5, y: 0.5 };
  const skin = averageColor(image, Math.round(bridge.x * image.width), Math.round(bridge.y * image.height), 3);
  const leftCenter = centroid(landmarks, LANDMARK.leftEye);
  const rightCenter = centroid(landmarks, LANDMARK.rightEye);
  const eyeGap = Math.abs(rightCenter.x - leftCenter.x);
  const eyes = matchEyes(
    eyeBox(image, frame, landmarks, LANDMARK.leftEye, skin, eyeGap),
    eyeBox(image, frame, landmarks, LANDMARK.rightEye, skin, eyeGap),
    worldX(frame, (leftCenter.x + rightCenter.x) / 2),
  );
  const lidColor = (eye: Box) =>
    averageColor(
      image,
      Math.round(((eye.minX + eye.maxX) / 2 - frame.centerX + frame.size / 2) * (image.width / frame.size)),
      Math.round((frame.centerY + frame.size / 2 - eye.maxY) * (image.height / frame.size)) - LID_SAMPLE_GAP,
      1,
    );
  return {
    eyeLeft: eyes.left,
    eyeRight: eyes.right,
    browLeft: world(centroid(landmarks, LANDMARK.leftBrow)),
    browRight: world(centroid(landmarks, LANDMARK.rightBrow)),
    mouthLeft: at(LANDMARK.mouthLeft),
    mouthRight: at(LANDMARK.mouthRight),
    mouthTop: at(LANDMARK.mouthTop),
    mouthBottom: at(LANDMARK.mouthBottom),
    chin: at(LANDMARK.chin),
    lidLeft: lidColor(eyes.left),
    lidRight: lidColor(eyes.right),
  };
}

export interface EstimatedFace {
  leftEye: Point;
  rightEye: Point;
  mouth: Point;
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

// Used only for the fully drawn face, when no tracker points exist. Inputs are 0-1 image coordinates.
export function anchorsFromEstimate(estimate: EstimatedFace, frame: CaptureFrame, skin: Rgb): FaceAnchors {
  const world = (u: number, v: number): Point => ({ x: worldX(frame, clampUnit(u)), y: worldY(frame, clampUnit(v)) });
  const gap = Math.abs(estimate.rightEye.x - estimate.leftEye.x);
  const eye = (center: Point): Box => {
    const low = world(center.x - gap * 0.22, center.y + gap * 0.22);
    const high = world(center.x + gap * 0.22, center.y - gap * 0.22);
    return { minX: low.x, minY: low.y, maxX: high.x, maxY: high.y };
  };
  return {
    eyeLeft: eye(estimate.leftEye),
    eyeRight: eye(estimate.rightEye),
    browLeft: world(estimate.leftEye.x, estimate.leftEye.y - gap * 0.4),
    browRight: world(estimate.rightEye.x, estimate.rightEye.y - gap * 0.4),
    mouthLeft: world(estimate.mouth.x - gap * 0.35, estimate.mouth.y),
    mouthRight: world(estimate.mouth.x + gap * 0.35, estimate.mouth.y),
    mouthTop: world(estimate.mouth.x, estimate.mouth.y - gap * 0.05),
    mouthBottom: world(estimate.mouth.x, estimate.mouth.y + gap * 0.12),
    chin: world(estimate.mouth.x, estimate.mouth.y + gap * 0.5),
    lidLeft: skin,
    lidRight: skin,
  };
}

// Guess for characters neither the tracker nor Muse Spark could read: a face centred on the front of the head.
export const GUESSED_FACE: EstimatedFace = { leftEye: { x: 0.39, y: 0.6 }, rightEye: { x: 0.61, y: 0.6 }, mouth: { x: 0.5, y: 0.8 } };
