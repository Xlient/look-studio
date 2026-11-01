export const EXPRESSION = { smile: 0, browRaise: 1, jawOpen: 2, blinkA: 3, blinkB: 4, squintA: 5, squintB: 6, mouthRound: 7 } as const;
export const EXPRESSION_COUNT = 8;

export interface BlendshapeScore {
  categoryName: string;
  score: number;
}

const RAW = {
  smileLeft: 0,
  smileRight: 1,
  browInner: 2,
  browOuterLeft: 3,
  browOuterRight: 4,
  jaw: 5,
  blinkLeft: 6,
  blinkRight: 7,
  squintLeft: 8,
  squintRight: 9,
  lowerDownLeft: 10,
  lowerDownRight: 11,
  upperUpLeft: 12,
  upperUpRight: 13,
  funnel: 14,
  pucker: 15,
  close: 16,
} as const;

const SOURCES: Readonly<Record<string, number>> = {
  mouthSmileLeft: RAW.smileLeft,
  mouthSmileRight: RAW.smileRight,
  browInnerUp: RAW.browInner,
  browOuterUpLeft: RAW.browOuterLeft,
  browOuterUpRight: RAW.browOuterRight,
  jawOpen: RAW.jaw,
  eyeBlinkLeft: RAW.blinkLeft,
  eyeBlinkRight: RAW.blinkRight,
  eyeSquintLeft: RAW.squintLeft,
  eyeSquintRight: RAW.squintRight,
  mouthLowerDownLeft: RAW.lowerDownLeft,
  mouthLowerDownRight: RAW.lowerDownRight,
  mouthUpperUpLeft: RAW.upperUpLeft,
  mouthUpperUpRight: RAW.upperUpRight,
  mouthFunnel: RAW.funnel,
  mouthPucker: RAW.pucker,
  mouthClose: RAW.close,
};

const raw = new Float32Array(17);

// Resting faces score well above zero, so each input gets a dead zone before it reaches the avatar.
const RANGES: readonly (readonly [low: number, high: number])[] = [
  [0.1, 0.7],
  [0.15, 0.7],
  [0.04, 0.4],
  [0.25, 0.65],
  [0.25, 0.65],
  [0.25, 0.8],
  [0.25, 0.8],
  [0.15, 0.6],
];

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const at = (index: number) => raw[index] ?? 0;

// Talking parts the lips far more than it drops the jaw, so the mouth opens on whichever is larger.
export function mouthOpenness(jaw: number, lowerDown: number, upperUp: number, close: number): number {
  return Math.max(jaw, lowerDown * 0.8 + upperUp * 0.4) - close * 0.5;
}

export function writeExpressions(out: Float32Array, scores: readonly BlendshapeScore[] | undefined): Float32Array {
  out.fill(0);
  if (scores === undefined) {
    return out;
  }
  raw.fill(0);
  for (const { categoryName, score } of scores) {
    const slot = SOURCES[categoryName];
    if (slot !== undefined) {
      raw[slot] = unit(score);
    }
  }
  out[EXPRESSION.smile] = (at(RAW.smileLeft) + at(RAW.smileRight)) / 2;
  out[EXPRESSION.browRaise] = at(RAW.browInner) * 0.5 + (at(RAW.browOuterLeft) + at(RAW.browOuterRight)) * 0.25;
  out[EXPRESSION.jawOpen] = mouthOpenness(
    at(RAW.jaw),
    (at(RAW.lowerDownLeft) + at(RAW.lowerDownRight)) / 2,
    (at(RAW.upperUpLeft) + at(RAW.upperUpRight)) / 2,
    at(RAW.close),
  );
  out[EXPRESSION.blinkA] = at(RAW.blinkLeft);
  out[EXPRESSION.blinkB] = at(RAW.blinkRight);
  out[EXPRESSION.squintA] = at(RAW.squintLeft);
  out[EXPRESSION.squintB] = at(RAW.squintRight);
  out[EXPRESSION.mouthRound] = Math.max(at(RAW.funnel), at(RAW.pucker));
  for (let i = 0; i < EXPRESSION_COUNT; i += 1) {
    const [low, high] = RANGES[i] ?? [0, 1];
    out[i] = unit(((out[i] ?? 0) - low) / (high - low));
  }
  return out;
}

// A and B are MediaPipe's left and right; the avatar faces the viewer, so its screen sides depend on mirroring.
export function toAvatarExpressions(out: Float32Array, tracked: Float32Array, mirror: boolean): Float32Array {
  out.set(tracked);
  const screenLeftBlink = mirror ? EXPRESSION.blinkA : EXPRESSION.blinkB;
  const screenRightBlink = mirror ? EXPRESSION.blinkB : EXPRESSION.blinkA;
  const screenLeftSquint = mirror ? EXPRESSION.squintA : EXPRESSION.squintB;
  const screenRightSquint = mirror ? EXPRESSION.squintB : EXPRESSION.squintA;
  out[EXPRESSION.blinkA] = tracked[screenLeftBlink] ?? 0;
  out[EXPRESSION.blinkB] = tracked[screenRightBlink] ?? 0;
  out[EXPRESSION.squintA] = (tracked[screenLeftSquint] ?? 0) * (1 - (tracked[screenLeftBlink] ?? 0));
  out[EXPRESSION.squintB] = (tracked[screenRightSquint] ?? 0) * (1 - (tracked[screenRightBlink] ?? 0));
  return out;
}

const EASE_PER_S = 25;

export function stepExpressions(current: Float32Array, target: Float32Array | null, dtS: number): Float32Array {
  const blend = dtS > 0 ? 1 - Math.exp(-EASE_PER_S * Math.min(dtS, 0.25)) : 0;
  for (let i = 0; i < current.length; i += 1) {
    const value = current[i] ?? 0;
    current[i] = value + ((target?.[i] ?? 0) - value) * blend;
  }
  return current;
}
