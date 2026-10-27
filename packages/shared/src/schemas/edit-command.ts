import { z } from "zod";
import { HexColor } from "./look-spec.ts";
import { Offset3D, WearableSpec } from "./wearable-spec.ts";

export const EditOp = z.enum(["add", "remove", "move", "scale", "recolor", "toggle"]);
export type EditOp = z.infer<typeof EditOp>;

export const EditCommand = z.object({
  op: EditOp,
  targetId: z.string().min(1),
  wearable: WearableSpec.optional(),
  color: HexColor.optional(),
  delta: Offset3D.optional(),
  factor: z.number().positive().optional(),
});
export type EditCommand = z.infer<typeof EditCommand>;
