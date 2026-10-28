import { toJSONSchema, z } from "zod";
import { AnchorRegion, EditCommand, EditOp, HexColor, WearableType } from "@look-studio/shared";
import type { LookSpec } from "@look-studio/shared";
import { toWearableSpec } from "./look-draft.ts";

export const NEW_TARGET_ID = "new";
const MAX_DELTA = 0.5;

export const EditDraft = z.object({
  op: EditOp,
  targetId: z.string(),
  color: z.string().nullable(),
  delta: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  factor: z.number().nullable(),
  wearable: z.object({ type: WearableType, label: z.string(), region: AnchorRegion }).nullable(),
});
export type EditDraft = z.infer<typeof EditDraft>;

export const EditDraftJsonSchema = toJSONSchema(EditDraft) as unknown as Record<string, unknown>;

export function buildEditPrompt(utterance: string, look: LookSpec): string {
  const items = look.wearables.map(
    (wearable) => `- ${wearable.id}: ${wearable.label} (${wearable.type}, ${wearable.anchor.region})`,
  );
  return [
    "You are Look Artist, the stylist inside Look Studio. Turn the user's request into one edit.",
    `Current look: ${look.name} (${look.style}).`,
    "Current wearables:",
    ...(items.length === 0 ? ["- none"] : items),
    `- targetId must be one of the ids above, or "${NEW_TARGET_ID}" when op is "add".`,
    "- add: fill wearable. recolor: color as #RRGGBB. scale: factor (2 = twice as big).",
    `- move: delta in head-widths, each axis between -${MAX_DELTA} and ${MAX_DELTA}; +y is up, +x is the viewer's right, +z is toward the camera.`,
    "- Set every field that the op does not use to null.",
    "- Never describe, rate, or comment on the person's face, skin, or body.",
    `User request: """${utterance}"""`,
  ].join("\n");
}

function clampDelta(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_DELTA, Math.max(-MAX_DELTA, value)) : 0;
}

function clampFactor(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.min(4, Math.max(0.25, value)) : null;
}

function resolveCommand(draft: EditDraft, look: LookSpec, newId: string): EditCommand | null {
  if (draft.op === "add") {
    if (draft.wearable === null) {
      return null;
    }
    return { op: "add", targetId: newId, wearable: toWearableSpec({ ...draft.wearable, scale: 1 }, newId) };
  }
  if (!look.wearables.some((wearable) => wearable.id === draft.targetId)) {
    return null;
  }
  const targetId = draft.targetId;
  switch (draft.op) {
    case "remove":
    case "toggle":
      return { op: draft.op, targetId };
    case "recolor": {
      const color = draft.color?.trim() ?? "";
      return HexColor.safeParse(color).success ? { op: "recolor", targetId, color } : null;
    }
    case "move":
      return draft.delta === null
        ? null
        : {
            op: "move",
            targetId,
            delta: { x: clampDelta(draft.delta.x), y: clampDelta(draft.delta.y), z: clampDelta(draft.delta.z) },
          };
    case "scale": {
      const factor = draft.factor === null ? null : clampFactor(draft.factor);
      return factor === null ? null : { op: "scale", targetId, factor };
    }
  }
}

export function draftToEditCommand(draft: EditDraft, look: LookSpec, newId: string): EditCommand | null {
  const command = resolveCommand(draft, look, newId);
  if (command === null) {
    return null;
  }
  const checked = EditCommand.safeParse(command);
  return checked.success ? checked.data : null;
}
