import { z } from "zod";

export const AVATAR_DESCRIPTION_MAX = 500;
export const AVATAR_CONCEPT_COUNT = 3;

export const AvatarImage = z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export type AvatarImage = z.infer<typeof AvatarImage>;

export const AvatarConcept = z.object({
  id: z.string().min(1).max(100),
  image: AvatarImage,
});
export type AvatarConcept = z.infer<typeof AvatarConcept>;

export const AvatarStage = z.enum(["queued", "modeling", "rigging", "ready", "failed"]);
export type AvatarStage = z.infer<typeof AvatarStage>;

export const AvatarJobStatus = z.object({
  jobId: z.string().min(1),
  stage: AvatarStage,
  progress: z.number().int().min(0).max(100),
  error: z.string().max(200).optional(),
});
export type AvatarJobStatus = z.infer<typeof AvatarJobStatus>;

export const AvatarSpec = z.object({
  id: z.string().min(1),
  description: z.string().min(1).max(AVATAR_DESCRIPTION_MAX),
  conceptId: z.string().min(1).max(100),
  createdAt: z.string().datetime().optional(),
});
export type AvatarSpec = z.infer<typeof AvatarSpec>;
