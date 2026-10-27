import { z } from "zod";

export const CritiqueSeverity = z.enum(["info", "warn", "error"]);
export type CritiqueSeverity = z.infer<typeof CritiqueSeverity>;

export const CritiqueIssue = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: CritiqueSeverity,
  targetId: z.string().min(1).optional(),
});
export type CritiqueIssue = z.infer<typeof CritiqueIssue>;

export const CritiqueReport = z.object({
  lookId: z.string().min(1),
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(CritiqueIssue).max(50),
  suggestions: z.array(z.string().min(1)).max(20),
});
export type CritiqueReport = z.infer<typeof CritiqueReport>;
