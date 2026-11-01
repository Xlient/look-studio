import { EXPRESSION } from "../tracking/expressions.ts";

export const VRM_EXPRESSIONS = ["aa", "oh", "ou", "happy", "surprised", "blinkLeft", "blinkRight"] as const;
export type VrmExpression = (typeof VRM_EXPRESSIONS)[number];

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// Expressions arrive in screen terms: blinkA is the eye on the viewer's left, which is the avatar's own right eye.
export function writeVrmWeights(out: Float32Array, expressions: Float32Array): Float32Array {
  const open = unit(expressions[EXPRESSION.jawOpen] ?? 0);
  const round = unit(expressions[EXPRESSION.mouthRound] ?? 0);
  const smile = unit(expressions[EXPRESSION.smile] ?? 0);
  out[0] = open * (1 - round);
  out[1] = open * round;
  out[2] = round * (1 - open);
  out[3] = smile * (1 - open * 0.5);
  out[4] = unit(expressions[EXPRESSION.browRaise] ?? 0) * 0.6;
  out[5] = unit(expressions[EXPRESSION.blinkB] ?? 0);
  out[6] = unit(expressions[EXPRESSION.blinkA] ?? 0);
  return out;
}
