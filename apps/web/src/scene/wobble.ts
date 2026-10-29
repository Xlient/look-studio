import type { HeadAnchor } from "./head-anchor.ts";
import { clampSpringParams, createSpring, resetSpring, stepSpring } from "./spring.ts";
import type { Spring, SpringParams } from "./spring.ts";
import type { HeadTemplate } from "./wearable-layout.ts";

export interface WobbleParams extends SpringParams {
  gain: number;
  maxAngle: number;
}

export const WOBBLE_PARAMS: Record<HeadTemplate, WobbleParams> = {
  hat: { ...clampSpringParams({ stiffness: 70, damping: 5 }), gain: 0.12, maxAngle: 0.35 },
  crown: { ...clampSpringParams({ stiffness: 160, damping: 9 }), gain: 0.06, maxAngle: 0.18 },
};

export interface Wobble {
  readonly roll: Spring;
  readonly pitch: Spring;
  lastX: number;
  lastY: number;
  tracking: boolean;
}

export function createWobble(): Wobble {
  return { roll: createSpring(), pitch: createSpring(), lastX: 0, lastY: 0, tracking: false };
}

function clampAngle(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value));
}

// Head speed in head-widths per second pushes the prop the opposite way, so it lags and then swings back.
export function stepWobble(wobble: Wobble, anchor: HeadAnchor, dtS: number, params: WobbleParams | null): Wobble {
  if (params === null || !anchor.visible || anchor.scale <= 0) {
    resetSpring(wobble.roll);
    resetSpring(wobble.pitch);
    wobble.tracking = false;
    return wobble;
  }
  if (!wobble.tracking || !Number.isFinite(dtS) || dtS <= 0) {
    wobble.lastX = anchor.x;
    wobble.lastY = anchor.y;
    wobble.tracking = true;
    return wobble;
  }
  const vx = (anchor.x - wobble.lastX) / (anchor.scale * dtS);
  const vy = (anchor.y - wobble.lastY) / (anchor.scale * dtS);
  wobble.lastX = anchor.x;
  wobble.lastY = anchor.y;
  stepSpring(wobble.roll, clampAngle(vx * params.gain, params.maxAngle), params, dtS);
  stepSpring(wobble.pitch, clampAngle(-vy * params.gain, params.maxAngle), params, dtS);
  wobble.roll.position = clampAngle(wobble.roll.position, params.maxAngle);
  wobble.pitch.position = clampAngle(wobble.pitch.position, params.maxAngle);
  return wobble;
}
