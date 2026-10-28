import type { LookSpec, WearableType } from "@look-studio/shared";

export const MAX_SWATCHES = 5;
export const MAX_GLYPHS = 4;

const GLYPHS: Record<WearableType, string> = {
  hat: "♛",
  glasses: "∞",
  jacket: "▣",
  watch: "◷",
  necklace: "◌",
  shoes: "▬",
  custom: "✦",
};

const NEUTRAL = "#D9D4C7";

export interface ThumbnailModel {
  swatches: string[];
  lips: string;
  cheeks: string;
  eyes: string;
  glyphs: string[];
}

export function thumbnailModel(look: LookSpec): ThumbnailModel {
  const makeup = look.makeup;
  return {
    swatches: (look.palette ?? []).slice(0, MAX_SWATCHES),
    lips: makeup?.lips?.color ?? NEUTRAL,
    cheeks: makeup?.blush?.color ?? NEUTRAL,
    eyes: makeup?.eyeshadow?.color ?? NEUTRAL,
    glyphs: look.wearables
      .filter((wearable) => wearable.visible !== false)
      .slice(0, MAX_GLYPHS)
      .map((wearable) => GLYPHS[wearable.type]),
  };
}
