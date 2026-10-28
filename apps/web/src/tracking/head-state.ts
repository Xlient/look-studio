export const LANDMARK_COUNT = 478;

export interface HeadState {
  readonly landmarks: Float32Array;
  readonly pose: Float32Array;
  landmarkCount: number;
  confidence: number;
  timestampMs: number;
}

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface FaceSample {
  faceLandmarks: LandmarkPoint[][];
  facialTransformationMatrixes?: { data: number[] }[];
}

export function createHeadState(): HeadState {
  return {
    landmarks: new Float32Array(LANDMARK_COUNT * 3),
    pose: new Float32Array(16),
    landmarkCount: 0,
    confidence: 0,
    timestampMs: 0,
  };
}

export function writeHeadState(target: HeadState, sample: FaceSample, timestampMs: number): HeadState {
  target.timestampMs = timestampMs;
  const face = sample.faceLandmarks[0];
  if (face === undefined || face.length === 0) {
    target.landmarkCount = 0;
    target.confidence = 0;
    return target;
  }
  const count = Math.min(face.length, LANDMARK_COUNT);
  let inFrame = 0;
  for (let i = 0; i < count; i += 1) {
    const point = face[i];
    if (point === undefined) {
      break;
    }
    target.landmarks[i * 3] = point.x;
    target.landmarks[i * 3 + 1] = point.y;
    target.landmarks[i * 3 + 2] = point.z;
    if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
      inFrame += 1;
    }
  }
  target.landmarkCount = count;
  target.confidence = inFrame / count;
  const matrix = sample.facialTransformationMatrixes?.[0]?.data;
  if (matrix !== undefined && matrix.length >= 16) {
    for (let i = 0; i < 16; i += 1) {
      target.pose[i] = matrix[i] ?? 0;
    }
  }
  return target;
}

export interface FpsCounter {
  tick(tMs: number): number;
  readonly fps: number;
}

export function createFpsCounter(windowSize = 30): FpsCounter {
  const times = new Float64Array(windowSize);
  let count = 0;
  let head = 0;
  let fps = 0;
  return {
    tick(tMs: number): number {
      times[head] = tMs;
      head = (head + 1) % windowSize;
      count = Math.min(count + 1, windowSize);
      if (count > 1) {
        const oldest = times[(head - count + windowSize) % windowSize] ?? tMs;
        const span = tMs - oldest;
        fps = span > 0 ? ((count - 1) * 1000) / span : 0;
      }
      return fps;
    },
    get fps() {
      return fps;
    },
  };
}
