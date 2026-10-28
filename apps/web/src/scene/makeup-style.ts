import type { Makeup } from "@look-studio/shared";

export type MakeupRegion = "lips" | "gloss" | "blush" | "eyeshadow" | "brows";
export type BlendOp = "multiply" | "soft-light" | "screen" | "color";

export interface MakeupPass {
  region: MakeupRegion;
  op: BlendOp;
  color: string;
  alpha: number;
  featherRatio: number;
}

const SHIMMER = "#ffffff";

const LIP_FINISH = {
  matte: { op: "multiply", alphaScale: 1, featherRatio: 0.02 },
  satin: { op: "color", alphaScale: 1, featherRatio: 0.025 },
  gloss: { op: "multiply", alphaScale: 0.8, featherRatio: 0.025 },
} as const;

export function makeupPasses(makeup: Makeup | undefined): MakeupPass[] {
  if (makeup === undefined) {
    return [];
  }
  const passes: MakeupPass[] = [];
  if (makeup.blush !== undefined) {
    passes.push({ region: "blush", op: "multiply", color: makeup.blush.color, alpha: makeup.blush.opacity, featherRatio: 0.25 });
  }
  if (makeup.eyeshadow !== undefined) {
    const { color, opacity, finish } = makeup.eyeshadow;
    passes.push({ region: "eyeshadow", op: "multiply", color, alpha: opacity, featherRatio: 0.06 });
    if (finish === "shimmer") {
      passes.push({ region: "eyeshadow", op: "soft-light", color: SHIMMER, alpha: opacity * 0.5, featherRatio: 0.05 });
    }
  }
  if (makeup.brows !== undefined) {
    passes.push({ region: "brows", op: "multiply", color: makeup.brows.color, alpha: makeup.brows.opacity, featherRatio: 0.02 });
  }
  if (makeup.lips !== undefined) {
    const { color, opacity, finish } = makeup.lips;
    const style = LIP_FINISH[finish];
    passes.push({ region: "lips", op: style.op, color, alpha: opacity * style.alphaScale, featherRatio: style.featherRatio });
    if (finish === "gloss") {
      passes.push({ region: "gloss", op: "screen", color: SHIMMER, alpha: 0.35, featherRatio: 0.05 });
    }
  }
  return passes;
}

export function featherPx(pass: MakeupPass, eyeDistance: number): number {
  return Math.max(0.5, Math.round(pass.featherRatio * eyeDistance * 2) / 2);
}
