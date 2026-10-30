import { z } from "zod";
import { HexColor, WearableSpec } from "./wearable-spec.ts";

export { HexColor };

export const LookStyle = z.enum(["casual", "formal", "street", "avant-garde", "sport"]);
export type LookStyle = z.infer<typeof LookStyle>;

const Opacity = z.number().min(0).max(1);

export const LipFinish = z.enum(["matte", "satin", "gloss"]);
export type LipFinish = z.infer<typeof LipFinish>;

export const ShadowFinish = z.enum(["matte", "shimmer"]);
export type ShadowFinish = z.infer<typeof ShadowFinish>;

export const SkinCoverage = z.enum(["none", "sheer", "light", "medium", "full"]);
export type SkinCoverage = z.infer<typeof SkinCoverage>;

export const SkinFinish = z.enum(["matte", "natural", "dewy"]);
export type SkinFinish = z.infer<typeof SkinFinish>;

const TintLayer = z.object({ color: HexColor, opacity: Opacity });

export const Makeup = z.object({
  lips: TintLayer.extend({ finish: LipFinish }).optional(),
  blush: TintLayer.optional(),
  eyeshadow: TintLayer.extend({ finish: ShadowFinish }).optional(),
  brows: TintLayer.optional(),
  skin: z.object({ smoothing: Opacity, coverage: SkinCoverage.optional(), finish: SkinFinish.optional() }).optional(),
});
export type Makeup = z.infer<typeof Makeup>;

export const FacialHairStyle = z.enum(["none", "stubble", "mustache", "goatee", "boxed", "full"]);
export type FacialHairStyle = z.infer<typeof FacialHairStyle>;

export const BrowShape = z.enum(["natural", "tidy", "fuller"]);
export type BrowShape = z.infer<typeof BrowShape>;

export const FacialHair = z.object({
  style: FacialHairStyle,
  length: Opacity,
  density: Opacity,
  color: HexColor,
  grey: Opacity,
});
export type FacialHair = z.infer<typeof FacialHair>;

export const Grooming = z.object({
  facialHair: FacialHair.optional(),
  brows: BrowShape.optional(),
  shadowCover: Opacity.optional(),
});
export type Grooming = z.infer<typeof Grooming>;

export const LookSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().max(500).optional(),
  wearables: z.array(WearableSpec).max(20),
  palette: z.array(HexColor).max(8).optional(),
  makeup: Makeup.optional(),
  grooming: Grooming.optional(),
  style: LookStyle,
  createdAt: z.string().datetime().optional(),
});
export type LookSpec = z.infer<typeof LookSpec>;
