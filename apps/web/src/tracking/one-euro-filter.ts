import type { PoseFilter } from "@look-studio/shared";

export interface OneEuroParams {
  minCutoffHz: number;
  beta: number;
  derivativeCutoffHz: number;
  resetAfterMs: number;
}

// Landmarks are normalized to the frame, so a fast head move is about 0.5 units per second.
export const LANDMARK_FILTER: OneEuroParams = { minCutoffHz: 1, beta: 15, derivativeCutoffHz: 1, resetAfterMs: 500 };
export const POSE_FILTER: OneEuroParams = { minCutoffHz: 1, beta: 5, derivativeCutoffHz: 1, resetAfterMs: 500 };

const smoothing = (cutoffHz: number, dtS: number) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS));

export function createOneEuroFilter(params: OneEuroParams): PoseFilter<Float32Array> {
  let values = new Float32Array(0);
  let speeds = new Float32Array(0);
  let lastMs = Number.NaN;

  const restart = (sample: Float32Array, tMs: number) => {
    if (values.length !== sample.length) {
      values = new Float32Array(sample.length);
      speeds = new Float32Array(sample.length);
    }
    values.set(sample);
    speeds.fill(0);
    lastMs = tMs;
    return values;
  };

  return {
    filter(sample, tMs) {
      const dtMs = tMs - lastMs;
      if (values.length !== sample.length || !(dtMs <= params.resetAfterMs)) {
        return restart(sample, tMs);
      }
      if (dtMs <= 0) {
        return values;
      }
      const dtS = dtMs / 1000;
      const speedAlpha = smoothing(params.derivativeCutoffHz, dtS);
      for (let i = 0; i < sample.length; i += 1) {
        const raw = sample[i] ?? 0;
        const previous = values[i] ?? 0;
        if (!Number.isFinite(raw)) {
          continue;
        }
        const speed = (speeds[i] ?? 0) + speedAlpha * ((raw - previous) / dtS - (speeds[i] ?? 0));
        speeds[i] = speed;
        values[i] = previous + smoothing(params.minCutoffHz + params.beta * Math.abs(speed), dtS) * (raw - previous);
      }
      lastMs = tMs;
      return values;
    },
  };
}
