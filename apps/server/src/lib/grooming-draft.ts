import { z } from "zod";
import { BrowShape, FacialHairStyle, HexColor } from "@look-studio/shared";
import type { Grooming } from "@look-studio/shared";

export const SHADOW_COVER_CAP = 0.6;
const MIN_DENSITY = 0.2;

export const DraftGrooming = z.object({
  facialHairStyle: FacialHairStyle,
  facialHairLength: z.number(),
  facialHairDensity: z.number(),
  facialHairColor: z.string(),
  facialHairGrey: z.number(),
  browShape: BrowShape,
  shadowCover: z.number(),
});
export type DraftGrooming = z.infer<typeof DraftGrooming>;

export const GROOMING_GUIDE = [
  "- grooming: facialHairStyle (none, stubble, mustache, goatee, boxed, full) painted onto the user's face, with facialHairLength, facialHairDensity, and facialHairGrey from 0 to 1 and facialHairColor as #RRGGBB.",
  "  Example: 'short boxed beard, salt and pepper' is boxed, length 0.3, density 0.8, grey 0.5, a dark brown colour.",
  "- browShape: natural, tidy, or fuller. shadowCover: 0 to 1, a subtle concealer over five o'clock shadow.",
  "- Facial hair can only be added, never removed. For clean-shaven or interview looks use none with shadowCover about 0.4.",
  "- Use none, natural, and 0 unless the request or the photo's styling calls for grooming. Describe looks neutrally.",
];

function unit(value: number, min = 0, max = 1): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function toGrooming(draft: DraftGrooming): Grooming | undefined {
  const color = draft.facialHairColor.trim();
  const hasHair = draft.facialHairStyle !== "none" && HexColor.safeParse(color).success;
  const shadowCover = unit(draft.shadowCover, 0, SHADOW_COVER_CAP);
  const grooming: Grooming = {
    ...(hasHair
      ? {
          facialHair: {
            style: draft.facialHairStyle,
            length: unit(draft.facialHairLength),
            density: unit(draft.facialHairDensity, MIN_DENSITY),
            color,
            grey: unit(draft.facialHairGrey),
          },
        }
      : {}),
    ...(draft.browShape === "natural" ? {} : { brows: draft.browShape }),
    ...(shadowCover > 0 ? { shadowCover } : {}),
  };
  return Object.keys(grooming).length === 0 ? undefined : grooming;
}
