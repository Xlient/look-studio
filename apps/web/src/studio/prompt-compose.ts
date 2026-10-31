export const OCCASIONS = ["Work", "Date night", "Party", "Wedding", "Festival"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const COMPOSE_TEXT_MAX = 1800;

export const VIBE_MIN = 0;
export const VIBE_MAX = 100;
export const VIBE_DEFAULT = 50;

export function vibeLabel(vibe: number): string {
  if (vibe < 34) {
    return "subtle";
  }
  return vibe < 67 ? "balanced" : "bold";
}

export function clampVibe(vibe: number): number {
  return Number.isFinite(vibe) ? Math.min(VIBE_MAX, Math.max(VIBE_MIN, Math.round(vibe))) : VIBE_DEFAULT;
}

export const SKIN_TONES = ["fair", "light", "medium", "tan", "deep"] as const;
export type SkinTone = (typeof SKIN_TONES)[number];
export const UNDERTONES = ["cool", "neutral", "warm"] as const;
export type Undertone = (typeof UNDERTONES)[number];

export interface SkinChoice {
  tone?: SkinTone;
  undertone?: Undertone;
}

export interface LookContext {
  occasion: Occasion | null;
  vibe: number;
  skin?: SkinChoice;
}

function pick<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

export function parseSkinChoice(value: unknown): SkinChoice {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const tone = pick(SKIN_TONES, "tone" in value ? value.tone : undefined);
  const undertone = pick(UNDERTONES, "undertone" in value ? value.undertone : undefined);
  return { ...(tone === undefined ? {} : { tone }), ...(undertone === undefined ? {} : { undertone }) };
}

export function skinLine(skin: SkinChoice | undefined): string | null {
  const parts = [skin?.tone, skin?.undertone === undefined ? undefined : `${skin.undertone} undertone`].filter((part) => part !== undefined);
  return parts.length === 0
    ? null
    : `The wearer's own skin: ${parts.join(", ")}. Pick makeup shades that flatter this. This is background, not a change request.`;
}

export function contextNote(context: LookContext): string {
  const vibe = vibeLabel(clampVibe(context.vibe));
  return context.occasion === null ? vibe : `${context.occasion.toLowerCase()} · ${vibe}`;
}

export function composePrompt(text: string, context: LookContext): string {
  const vibe = clampVibe(context.vibe);
  const lines = [text.trim()];
  if (context.occasion !== null) {
    lines.push(`Occasion: ${context.occasion.toLowerCase()}.`);
  }
  lines.push(`Vibe: ${vibe}/100 (${vibeLabel(vibe)}). Scale makeup intensity and wearable boldness to match.`);
  const skin = skinLine(context.skin);
  if (skin !== null) {
    lines.push(skin);
  }
  return lines.join("\n");
}

export function composeEdit(text: string, skin: SkinChoice | undefined): string {
  const line = skinLine(skin);
  return line === null ? text : `${text}\n${line}`;
}
