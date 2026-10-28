import { toJSONSchema, z } from "zod";
import { AnchorRegion, HexColor, LookSpec, LookStyle, WearableType } from "@look-studio/shared";
import type { WearableSpec } from "@look-studio/shared";

export const MAX_DRAFT_WEARABLES = 4;
export const MAX_PALETTE = 5;

export const DraftWearable = z.object({
  type: WearableType,
  label: z.string(),
  region: AnchorRegion,
  scale: z.number(),
});
export type DraftWearable = z.infer<typeof DraftWearable>;

export const LookDraft = z.object({
  name: z.string(),
  description: z.string(),
  style: LookStyle,
  palette: z.array(z.string()),
  wearables: z.array(DraftWearable),
});
export type LookDraft = z.infer<typeof LookDraft>;

export const LookDraftJsonSchema = toJSONSchema(LookDraft) as unknown as Record<string, unknown>;

const SAFETY_RULES = [
  "Never describe, rate, or comment on the person's face, skin, body, age, or attractiveness.",
  "Do not suggest skin smoothing, blemish removal, or any change to skin texture.",
];

export function buildLookPrompt(chat: string, hasImage: boolean): string {
  return [
    "You are Look Artist, the stylist inside Look Studio, a video-call effects app.",
    "Design one look from the user's request.",
    `- wearables: at most ${MAX_DRAFT_WEARABLES} virtual 3D props, each anchored to a body region; scale 1 is natural size.`,
    `- palette: at most ${MAX_PALETTE} colours as #RRGGBB for makeup and accents.`,
    "- name: two to four catchy words. description: one or two sentences.",
    hasImage
      ? "A reference photo is attached. Use only its colours, accessories, and overall style."
      : "No photo is attached.",
    ...SAFETY_RULES.map((rule) => `- ${rule}`),
    `User request: """${chat}"""`,
  ].join("\n");
}

export function clampText(value: string, max: number, fallback: string): string {
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? fallback : trimmed;
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(3, Math.max(0.25, value));
}

export function toWearableSpec(draft: DraftWearable, id: string): WearableSpec {
  return {
    id,
    type: draft.type,
    label: clampText(draft.label, 60, draft.type),
    anchor: { region: draft.region },
    scale: clampScale(draft.scale),
    visible: true,
  };
}

export function draftToLookSpec(draft: LookDraft, lookId: string): LookSpec | null {
  const palette = draft.palette
    .map((color) => color.trim())
    .filter((color) => HexColor.safeParse(color).success)
    .slice(0, MAX_PALETTE);
  const description = draft.description.trim().slice(0, 500);
  const candidate = {
    id: lookId,
    name: clampText(draft.name, 80, "Untitled look"),
    ...(description === "" ? {} : { description }),
    style: draft.style,
    ...(palette.length === 0 ? {} : { palette }),
    wearables: draft.wearables
      .slice(0, MAX_DRAFT_WEARABLES)
      .map((wearable, index) => toWearableSpec(wearable, `${lookId}-w${index + 1}`)),
  };
  const checked = LookSpec.safeParse(candidate);
  return checked.success ? checked.data : null;
}
