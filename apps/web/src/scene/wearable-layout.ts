import type { LookSpec, Offset3D, WearableSpec } from "@look-studio/shared";

// Head widths per outer-eye-corner span; an anatomical approximation, not a measurement.
export const HEAD_WIDTHS_TO_EYE_SPANS = 1.7;
export const SCALE_LIMITS = { min: 0.1, max: 5 } as const;
export const OFFSET_LIMIT = 2;
export const DEFAULT_HEAD_COLOR = 0xf5c542;
export const DEFAULT_GLASSES_COLOR = 0x1a1a1a;

const CROWN_WORDS = /\b(crown|tiara|diadem)s?\b/i;

export type HeadTemplate = "crown" | "hat";

export interface WearableSlot {
  id: string;
  color: number;
  scale: number;
  offset: Offset3D;
}

export interface WearableLayout {
  head: (WearableSlot & { template: HeadTemplate }) | null;
  eyes: WearableSlot | null;
}

export const EMPTY_LAYOUT: WearableLayout = { head: null, eyes: null };

export function headTemplate(wearable: WearableSpec): HeadTemplate | null {
  if (wearable.type !== "hat") {
    return null;
  }
  return CROWN_WORDS.test(wearable.label) ? "crown" : "hat";
}

export function hexColor(value: string | undefined, fallback: number): number {
  return value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value) ? Number.parseInt(value.slice(1), 16) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function eyeSpans(offset: Offset3D | undefined): Offset3D {
  const toSpans = (value: number) => clamp(value, -OFFSET_LIMIT, OFFSET_LIMIT) * HEAD_WIDTHS_TO_EYE_SPANS;
  return offset === undefined ? { x: 0, y: 0, z: 0 } : { x: toSpans(offset.x), y: toSpans(offset.y), z: toSpans(offset.z) };
}

function slotFor(wearable: WearableSpec, color: number): WearableSlot {
  return {
    id: wearable.id,
    color,
    scale: clamp(wearable.scale ?? 1, SCALE_LIMITS.min, SCALE_LIMITS.max),
    offset: eyeSpans(wearable.anchor.offset),
  };
}

export function wearableLayout(look: LookSpec | null): WearableLayout {
  if (look === null) {
    return EMPTY_LAYOUT;
  }
  const visible = look.wearables.filter((wearable) => wearable.visible !== false);
  const hat = visible.find((wearable) => headTemplate(wearable) !== null);
  const glasses = visible.find((wearable) => wearable.type === "glasses");
  const template = hat === undefined ? null : headTemplate(hat);
  return {
    head:
      hat === undefined || template === null
        ? null
        : { ...slotFor(hat, hexColor(hat.color ?? look.palette?.[0], DEFAULT_HEAD_COLOR)), template },
    eyes: glasses === undefined ? null : slotFor(glasses, hexColor(glasses.color ?? look.palette?.[1], DEFAULT_GLASSES_COLOR)),
  };
}
