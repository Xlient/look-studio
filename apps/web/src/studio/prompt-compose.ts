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

export interface LookContext {
  occasion: Occasion | null;
  vibe: number;
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
  return lines.join("\n");
}
