import { z } from "zod";

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export type HexColor = z.infer<typeof HexColor>;

export const AnchorRegion = z.enum([
  "head",
  "face",
  "neck",
  "torso",
  "left-hand",
  "right-hand",
  "waist",
  "feet",
  "floating",
  "screen",
]);
export type AnchorRegion = z.infer<typeof AnchorRegion>;

export const Offset3D = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Offset3D = z.infer<typeof Offset3D>;

export const WearableAnchor = z.object({
  region: AnchorRegion,
  offset: Offset3D.optional(),
});
export type WearableAnchor = z.infer<typeof WearableAnchor>;

export const WearableType = z.enum([
  "glasses",
  "hat",
  "jacket",
  "watch",
  "necklace",
  "shoes",
  "custom",
]);
export type WearableType = z.infer<typeof WearableType>;

export const WearableSpec = z.object({
  id: z.string().min(1),
  type: WearableType,
  label: z.string().min(1),
  assetUrl: z.string().url().optional(),
  anchor: WearableAnchor,
  scale: z.number().positive().optional(),
  visible: z.boolean().optional(),
  color: HexColor.optional(),
});
export type WearableSpec = z.infer<typeof WearableSpec>;
