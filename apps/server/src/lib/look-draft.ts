import { toJSONSchema, z } from "zod";
import { AnchorRegion, HexColor, LipFinish, LookSpec, LookStyle, ShadowFinish, WearableType } from "@look-studio/shared";
import type { Makeup, WearableSpec } from "@look-studio/shared";

export const MAX_DRAFT_WEARABLES = 4;
export const MAX_PALETTE = 5;

export const DraftWearable = z.object({
  type: WearableType,
  label: z.string(),
  region: AnchorRegion,
  scale: z.number(),
});
export type DraftWearable = z.infer<typeof DraftWearable>;

export const DraftMakeup = z.object({
  lipColor: z.string(),
  lipOpacity: z.number(),
  lipFinish: LipFinish,
  blushColor: z.string(),
  blushOpacity: z.number(),
  shadowColor: z.string(),
  shadowOpacity: z.number(),
  shadowFinish: ShadowFinish,
  browColor: z.string(),
  browOpacity: z.number(),
  skinSmoothing: z.number(),
});
export type DraftMakeup = z.infer<typeof DraftMakeup>;

export const MAKEUP_OPACITY_CAP = { lips: 0.85, blush: 0.45, eyeshadow: 0.65, brows: 0.8 } as const;
export const SKIN_SMOOTHING_CAP = 0.7;

export const LookDraft = z.object({
  name: z.string(),
  description: z.string(),
  style: LookStyle,
  palette: z.array(z.string()),
  wearables: z.array(DraftWearable),
  makeup: DraftMakeup,
});
export type LookDraft = z.infer<typeof LookDraft>;

export const LookDraftJsonSchema = toJSONSchema(LookDraft) as unknown as Record<string, unknown>;

const SAFETY_RULES = [
  "Never describe, rate, or comment on the person's face, skin, body, age, or attractiveness.",
];

export function buildLookPrompt(chat: string, hasImage: boolean): string {
  return [
    "You are Look Artist, the stylist inside Look Studio, a video-call effects app.",
    "Design one look from the user's request.",
    `- wearables: at most ${MAX_DRAFT_WEARABLES} virtual 3D props, each anchored to a body region; scale 1 is natural size.`,
    `- palette: at most ${MAX_PALETTE} colours as #RRGGBB for makeup and accents.`,
    "- makeup: lips, blush, eyeshadow and brows, each a #RRGGBB colour and opacity from 0 to 1; use opacity 0 to leave an area bare.",
    "- skinSmoothing: 0 to 1 soft-focus touch-up applied on the user's device; use 0 unless they ask for a touch-up, smoothing, an airbrushed or glam finish.",
    "- Bold colours are fine when asked, such as pink brows or blue lips; use the exact shade requested.",
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

function tint(color: string, opacity: number, cap: number): { color: string; opacity: number } | null {
  const hex = color.trim();
  if (!HexColor.safeParse(hex).success || !Number.isFinite(opacity) || opacity <= 0) {
    return null;
  }
  return { color: hex, opacity: Math.min(cap, opacity) };
}

export function toMakeup(draft: DraftMakeup): Makeup | undefined {
  const lips = tint(draft.lipColor, draft.lipOpacity, MAKEUP_OPACITY_CAP.lips);
  const blush = tint(draft.blushColor, draft.blushOpacity, MAKEUP_OPACITY_CAP.blush);
  const eyeshadow = tint(draft.shadowColor, draft.shadowOpacity, MAKEUP_OPACITY_CAP.eyeshadow);
  const brows = tint(draft.browColor, draft.browOpacity, MAKEUP_OPACITY_CAP.brows);
  const smoothing = Number.isFinite(draft.skinSmoothing) ? Math.min(SKIN_SMOOTHING_CAP, draft.skinSmoothing) : 0;
  const makeup: Makeup = {
    ...(lips === null ? {} : { lips: { ...lips, finish: draft.lipFinish } }),
    ...(blush === null ? {} : { blush }),
    ...(eyeshadow === null ? {} : { eyeshadow: { ...eyeshadow, finish: draft.shadowFinish } }),
    ...(brows === null ? {} : { brows }),
    ...(smoothing > 0 ? { skin: { smoothing } } : {}),
  };
  return Object.keys(makeup).length === 0 ? undefined : makeup;
}

export function draftToLookSpec(draft: LookDraft, lookId: string): LookSpec | null {
  const palette = draft.palette
    .map((color) => color.trim())
    .filter((color) => HexColor.safeParse(color).success)
    .slice(0, MAX_PALETTE);
  const description = draft.description.trim().slice(0, 500);
  const makeup = toMakeup(draft.makeup);
  const candidate = {
    id: lookId,
    name: clampText(draft.name, 80, "Untitled look"),
    ...(description === "" ? {} : { description }),
    style: draft.style,
    ...(palette.length === 0 ? {} : { palette }),
    ...(makeup === undefined ? {} : { makeup }),
    wearables: draft.wearables
      .slice(0, MAX_DRAFT_WEARABLES)
      .map((wearable, index) => toWearableSpec(wearable, `${lookId}-w${index + 1}`)),
  };
  const checked = LookSpec.safeParse(candidate);
  return checked.success ? checked.data : null;
}
