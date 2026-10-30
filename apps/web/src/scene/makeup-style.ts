import type { FacialHairStyle, Grooming, Makeup } from "@look-studio/shared";
import { GREY_HAIR, mixHex } from "./hair-texture.ts";
import type { HairTexture } from "./hair-texture.ts";
import { NATURAL_SHAPE } from "./makeup-regions.ts";
import type { GeometryShape } from "./makeup-regions.ts";

export type MakeupRegion = "lips" | "gloss" | "blush" | "eyeshadow" | "brows" | "mustache" | "goatee" | "beard";
export type BlendOp = "multiply" | "soft-light" | "screen" | "color" | "source-over";

export interface MakeupPass {
  region: MakeupRegion;
  op: BlendOp;
  color: string;
  alpha: number;
  featherRatio: number;
  texture?: HairTexture;
}

const SHIMMER = "#ffffff";
const VIVID = { minLightness: 0.4, minSaturation: 0.5, pastelLightness: 0.75 } as const;
const VIVID_COVER = 0.6;

export function isVividTint(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  if (hex.length !== 7 || !Number.isFinite(value)) {
    return false;
  }
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const max = Math.max(...channels) / 255;
  const min = Math.min(...channels) / 255;
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return lightness >= VIVID.minLightness && (saturation >= VIVID.minSaturation || lightness >= VIVID.pastelLightness);
}

// Multiply can only darken, so a light colour over dark hair or lids needs hue plus some coverage.
function tintPasses(region: MakeupRegion, color: string, alpha: number, featherRatio: number): MakeupPass[] {
  if (!isVividTint(color)) {
    return [{ region, op: "multiply", color, alpha, featherRatio }];
  }
  return [
    { region, op: "color", color, alpha, featherRatio },
    { region, op: "source-over", color, alpha: alpha * VIVID_COVER, featherRatio },
  ];
}

const LIP_FINISH = {
  matte: { op: "multiply", alphaScale: 1, featherRatio: 0.02 },
  satin: { op: "color", alphaScale: 1, featherRatio: 0.025 },
  gloss: { op: "multiply", alphaScale: 0.8, featherRatio: 0.025 },
} as const;

const FACIAL_HAIR_REGIONS: Record<FacialHairStyle, MakeupRegion[]> = {
  none: [],
  stubble: ["beard", "mustache"],
  mustache: ["mustache"],
  goatee: ["goatee", "mustache"],
  boxed: ["beard", "mustache"],
  full: ["beard", "mustache"],
};
const BEARD_REACH: Record<FacialHairStyle, number> = { none: 0, stubble: 0, mustache: 0, goatee: 0.5, boxed: 0.35, full: 0.8 };
const BROW_SCALE = { natural: 1, tidy: 0.85, fuller: 1.3 } as const;
const DEFAULT_BROW_HAIR = "#3b2a20";
const HAIR_BASE_ALPHA = 0.5;
const HAIR_STRAND_ALPHA = 0.85;
const STUBBLE_BASE_ALPHA = 0.15;
const STUBBLE_STRAND_ALPHA = 0.55;
// Strands need a near-hard edge; a wider blur would smear the texture into a flat fill.
const STRAND_FEATHER = 0.004;
const FULLER_BROW = { alpha: 0.6, density: 0.7 } as const;

export function groomingShape(grooming: Grooming | undefined): GeometryShape {
  if (grooming === undefined) {
    return NATURAL_SHAPE;
  }
  const hair = grooming.facialHair;
  return {
    browScale: BROW_SCALE[grooming.brows ?? "natural"],
    beardReach: hair === undefined ? 0 : BEARD_REACH[hair.style] * hair.length,
  };
}

function facialHairPasses(grooming: Grooming | undefined): MakeupPass[] {
  const hair = grooming?.facialHair;
  if (hair === undefined) {
    return [];
  }
  const stubble = hair.style === "stubble";
  const texture: HairTexture = { color: hair.color, grey: hair.grey, density: hair.density, strand: stubble ? "stubble" : "hair" };
  const base = mixHex(hair.color, GREY_HAIR, hair.grey);
  return FACIAL_HAIR_REGIONS[hair.style].flatMap((region): MakeupPass[] => [
    { region, op: "multiply", color: base, alpha: (stubble ? STUBBLE_BASE_ALPHA : HAIR_BASE_ALPHA) * hair.density, featherRatio: 0.08 },
    { region, op: "source-over", color: hair.color, alpha: stubble ? STUBBLE_STRAND_ALPHA : HAIR_STRAND_ALPHA, featherRatio: STRAND_FEATHER, texture },
  ]);
}

function fullerBrowPass(makeup: Makeup | undefined, grooming: Grooming | undefined): MakeupPass[] {
  if (grooming?.brows !== "fuller") {
    return [];
  }
  const color = makeup?.brows?.color ?? grooming.facialHair?.color ?? DEFAULT_BROW_HAIR;
  const texture: HairTexture = { color, grey: 0, density: FULLER_BROW.density, strand: "hair" };
  return [{ region: "brows", op: "source-over", color, alpha: FULLER_BROW.alpha, featherRatio: STRAND_FEATHER, texture }];
}

export function makeupPasses(makeup: Makeup | undefined, grooming?: Grooming): MakeupPass[] {
  const passes: MakeupPass[] = [...facialHairPasses(grooming), ...fullerBrowPass(makeup, grooming)];
  if (makeup === undefined) {
    return passes;
  }
  if (makeup.blush !== undefined) {
    passes.push({ region: "blush", op: "multiply", color: makeup.blush.color, alpha: makeup.blush.opacity, featherRatio: 0.25 });
  }
  if (makeup.eyeshadow !== undefined) {
    const { color, opacity, finish } = makeup.eyeshadow;
    passes.push(...tintPasses("eyeshadow", color, opacity, 0.06));
    if (finish === "shimmer") {
      passes.push({ region: "eyeshadow", op: "soft-light", color: SHIMMER, alpha: opacity * 0.5, featherRatio: 0.05 });
    }
  }
  if (makeup.brows !== undefined) {
    passes.push(...tintPasses("brows", makeup.brows.color, makeup.brows.opacity, 0.02));
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
