import { toJSONSchema, z } from "zod";
import { AnchorRegion, EditCommand, EditOp, HexColor, MAX_EDITS, MakeupArea, WearableType } from "@look-studio/shared";
import type { EditBatch, LookSpec } from "@look-studio/shared";
import { MAKEUP_OPACITY_CAP, toWearableSpec } from "./look-draft.ts";

export const NEW_TARGET_ID = "new";
const MAX_DELTA = 0.5;
const NEW_AREA_OPACITY_SHARE = 0.75;

export const EditDraft = z.object({
  op: EditOp,
  targetId: z.string(),
  color: z.string().nullable(),
  delta: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  factor: z.number().nullable(),
  opacity: z.number().nullable(),
  wearable: z.object({ type: WearableType, label: z.string(), region: AnchorRegion }).nullable(),
});
export type EditDraft = z.infer<typeof EditDraft>;

export const EditBatchDraft = z.object({ edits: z.array(EditDraft) });

export const EditBatchDraftJsonSchema = toJSONSchema(EditBatchDraft) as unknown as Record<string, unknown>;

export function buildEditPrompt(utterance: string, look: LookSpec): string {
  const items = look.wearables.map(
    (wearable) => `- ${wearable.id}: ${wearable.label} (${wearable.type}, ${wearable.anchor.region}, colour ${wearable.color ?? "default"})`,
  );
  const makeup = MakeupArea.options.map((area) => {
    const layer = look.makeup?.[area];
    return `- ${area}: ${layer === undefined ? "bare" : `${layer.color} at opacity ${layer.opacity}`}`;
  });
  return [
    `You are Look Artist, the stylist inside Look Studio. Turn the user's request into a list of edits, at most ${MAX_EDITS}.`,
    "- Make one edit for every change requested. Never drop part of the request; a message naming brows and lipstick needs two edits.",
    `Current look: ${look.name} (${look.style}).`,
    "Current wearables:",
    ...(items.length === 0 ? ["- none"] : items),
    "Current makeup:",
    ...makeup,
    `- For wearables, targetId must be one of the wearable ids above, or "${NEW_TARGET_ID}" when op is "add".`,
    `- For makeup (lips, blush, eyeshadow, brows), use op "makeup" with targetId set to the area, color as #RRGGBB, and opacity from 0 to 1 (0 removes it, null keeps the current one).`,
    "- Wearables and makeup are separate. Glasses, hats, and other items use recolor with the wearable's id, never op makeup.",
    "- Colour words such as white, black, or brown on a wearable or on makeup only name a colour. They are not requests about skin.",
    "- Relative requests start from the current values above. A little lighter or darker: shift the current colour about 25% toward white or black and keep its hue. More subtle or less bold: lower opacity by about a third and keep the colour (color null). A different shade: a nearby shade in the same colour family.",
    "- add: fill wearable. recolor: color as #RRGGBB, for wearables only. scale: factor (2 = twice as big).",
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

function resolveMakeup(draft: EditDraft, look: LookSpec): EditCommand | null {
  const area = MakeupArea.safeParse(draft.targetId.trim());
  if (!area.success) {
    return null;
  }
  const color = draft.color?.trim() ?? "";
  const hasColor = HexColor.safeParse(color).success;
  const cap = MAKEUP_OPACITY_CAP[area.data];
  const isNewArea = look.makeup?.[area.data] === undefined;
  const opacity =
    draft.opacity !== null && Number.isFinite(draft.opacity)
      ? Math.min(cap, Math.max(0, draft.opacity))
      : hasColor && isNewArea
        ? cap * NEW_AREA_OPACITY_SHARE
        : undefined;
  if (!hasColor && opacity === undefined) {
    return null;
  }
  return {
    op: "makeup",
    targetId: area.data,
    ...(hasColor ? { color } : {}),
    ...(opacity === undefined ? {} : { opacity }),
  };
}

function resolveCommand(draft: EditDraft, look: LookSpec, newId: string): EditCommand | null {
  if (draft.op === "makeup") {
    return resolveMakeup(draft, look);
  }
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

export function draftsToEditBatch(drafts: EditDraft[], look: LookSpec, newId: () => string): EditBatch | null {
  const wanted = drafts.slice(0, MAX_EDITS);
  const commands = wanted.flatMap((draft) => draftToEditCommand(draft, look, newId()) ?? []);
  return commands.length === 0 ? null : { commands, skipped: wanted.length - commands.length };
}

export function draftToEditCommand(draft: EditDraft, look: LookSpec, newId: string): EditCommand | null {
  const command = resolveCommand(draft, look, newId);
  if (command === null) {
    return null;
  }
  const checked = EditCommand.safeParse(command);
  return checked.success ? checked.data : null;
}
