import { toJSONSchema, z } from "zod";

export const ModerationCategory = z.enum([
  "ok",
  "sexual",
  "minor_safety",
  "hate_or_caricature",
  "violence_or_gore",
  "real_person",
  "other_unsafe",
]);
export type ModerationCategory = z.infer<typeof ModerationCategory>;

export const ModerationDraft = z.object({ allowed: z.boolean(), category: ModerationCategory });
export type ModerationDraft = z.infer<typeof ModerationDraft>;

export const ModerationDraftJsonSchema = toJSONSchema(ModerationDraft) as unknown as Record<string, unknown>;

export function buildModerationPrompt(description: string): string {
  return [
    "You review character descriptions for a video-call avatar maker. Decide if the character may be generated.",
    "Block: sexual or suggestive content; anything sexualising or endangering minors; hate symbols, slurs, or racial or ethnic caricatures;",
    "graphic violence or gore; impersonating a real, named person; anything else unsafe for a work or school call.",
    "Allow: original humans, animals, robots, fantasy and anime characters, costumes, and any skin tone, culture, or body type shown respectfully.",
    "Return allowed and the single best category (ok when allowed).",
    `Description: """${description}"""`,
  ].join("\n");
}

export function buildConceptPrompt(description: string, hasPhoto: boolean): string {
  return [
    "Full-body character design for a 3D avatar, front view, standing in an A-pose with arms angled down and away from the body,",
    "feet apart, whole body in frame, plain light grey background, even flat lighting, no shadows, no text.",
    "Stylised toon look with clean shapes, separated limbs, and a simple, clearly drawn face with large eyes and a visible mouth.",
    hasPhoto
      ? "Use the attached photo only for outfit, colours, and accessories. Do not copy the person's face, skin tone, or likeness; invent an original character."
      : "Invent an original character.",
    `Character: ${description}`,
  ].join(" ");
}

export function buildTexturePrompt(description: string): string {
  return `Flat toon shading, clean colours, no baked lighting. ${description}`.slice(0, 800);
}
