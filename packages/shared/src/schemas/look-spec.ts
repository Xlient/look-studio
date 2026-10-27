import { z } from "zod";
import { WearableSpec } from "./wearable-spec.ts";

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export type HexColor = z.infer<typeof HexColor>;

export const LookStyle = z.enum(["casual", "formal", "street", "avant-garde", "sport"]);
export type LookStyle = z.infer<typeof LookStyle>;

export const LookSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().max(500).optional(),
  wearables: z.array(WearableSpec).max(20),
  palette: z.array(HexColor).max(8).optional(),
  style: LookStyle,
  createdAt: z.string().datetime().optional(),
});
export type LookSpec = z.infer<typeof LookSpec>;
