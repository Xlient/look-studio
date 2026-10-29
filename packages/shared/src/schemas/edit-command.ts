import { z } from "zod";
import { HexColor } from "./look-spec.ts";
import { Offset3D, WearableSpec } from "./wearable-spec.ts";

export const EditOp = z.enum(["add", "remove", "move", "scale", "recolor", "toggle", "makeup"]);
export type EditOp = z.infer<typeof EditOp>;

export const MakeupArea = z.enum(["lips", "blush", "eyeshadow", "brows"]);
export type MakeupArea = z.infer<typeof MakeupArea>;

export const EditCommand = z.object({
  op: EditOp,
  targetId: z.string().min(1),
  wearable: WearableSpec.optional(),
  color: HexColor.optional(),
  delta: Offset3D.optional(),
  factor: z.number().positive().optional(),
  opacity: z.number().min(0).max(1).optional(),
});
export type EditCommand = z.infer<typeof EditCommand>;
