export const EXPRESSION = { smile: 0, browRaise: 1, jawOpen: 2, blinkA: 3, blinkB: 4, squintA: 5, squintB: 6 } as const;
export const EXPRESSION_COUNT = 7;

export interface BlendshapeScore {
  categoryName: string;
  score: number;
}

const SOURCES: Readonly<Record<string, readonly [slot: number, weight: number]>> = {
  mouthSmileLeft: [EXPRESSION.smile, 0.5],
  mouthSmileRight: [EXPRESSION.smile, 0.5],
  browInnerUp: [EXPRESSION.browRaise, 0.5],
  browOuterUpLeft: [EXPRESSION.browRaise, 0.25],
  browOuterUpRight: [EXPRESSION.browRaise, 0.25],
  jawOpen: [EXPRESSION.jawOpen, 1],
  eyeBlinkLeft: [EXPRESSION.blinkA, 1],
  eyeBlinkRight: [EXPRESSION.blinkB, 1],
  eyeSquintLeft: [EXPRESSION.squintA, 1],
  eyeSquintRight: [EXPRESSION.squintB, 1],
};

// Resting faces score well above zero, so each input gets a dead zone before it reaches the avatar.
const RANGES: readonly (readonly [low: number, high: number])[] = [
  [0.1, 0.7],
  [0.15, 0.7],
  [0.05, 0.6],
  [0.25, 0.65],
  [0.25, 0.65],
  [0.25, 0.8],
  [0.25, 0.8],
];

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function writeExpressions(out: Float32Array, scores: readonly BlendshapeScore[] | undefined): Float32Array {
  out.fill(0);
  if (scores === undefined) {
    return out;
  }
  for (const { categoryName, score } of scores) {
    const source = SOURCES[categoryName];
    if (source !== undefined) {
      out[source[0]] = (out[source[0]] ?? 0) + unit(score) * source[1];
    }
  }
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
