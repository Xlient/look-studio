import { z } from "zod";
import { AvatarCheck } from "@look-studio/shared";
import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { acquire, MUSE_SPARK_MODEL } from "./muse-services.ts";
import { callModelWithImage } from "./model-client.ts";
import type { FetchFn } from "./model-client.ts";
import { ModelError } from "./model-errors.ts";

export interface AvatarCheckService {
  check(renders: { front: string; side: string }, budget: BudgetTracker, signal: AbortSignal): Promise<AvatarCheck>;
}

const ISSUE_MAX = 200;
const clampedUnit = z.number().transform((value) => Math.min(1, Math.max(0, value)));

const AvatarCheckDraft = z.object({
  usable: z.boolean(),
  issue: z.string().transform((value) => value.trim().slice(0, ISSUE_MAX)),
  faceFound: z.boolean(),
  leftEyeX: clampedUnit,
  leftEyeY: clampedUnit,
  rightEyeX: clampedUnit,
  rightEyeY: clampedUnit,
  mouthX: clampedUnit,
  mouthY: clampedUnit,
});

const coordinate = { type: "number" };
export const AvatarCheckJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["usable", "issue", "faceFound", "leftEyeX", "leftEyeY", "rightEyeX", "rightEyeY", "mouthX", "mouthY"],
  properties: {
    usable: { type: "boolean" },
    issue: { type: "string" },
    faceFound: { type: "boolean" },
    leftEyeX: coordinate,
    leftEyeY: coordinate,
    rightEyeX: coordinate,
    rightEyeY: coordinate,
    mouthX: coordinate,
    mouthY: coordinate,
  },
};

export const AVATAR_CHECK_PROMPT = `These are renders of a generated 3D cartoon character's head: the first from the front, the second from the side. They will be used as a live video-call avatar.
Set usable to false only for a defect that would spoil it on a call: a missing or badly distorted face, a head that is not facing the front, or large holes. If usable is false, write one short plain sentence in issue saying what is wrong; otherwise leave issue empty.
Set faceFound to true if you can see eyes and a mouth in the first image, and give their centres as fractions of that image: x from the left edge, y from the top edge. leftEye is the eye on the left of the image. If faceFound is false, use 0.5 for every coordinate.`;

export interface MuseAvatarCheckDeps {
  readonly retryPolicy: RetryPolicy;
  readonly rateLimiter: RateLimiter;
  readonly onTokens: (total: number, budget: BudgetTracker) => void;
  readonly fetch?: FetchFn;
}

export class MuseAvatarCheckService implements AvatarCheckService {
  private readonly deps: MuseAvatarCheckDeps;

  constructor(deps: MuseAvatarCheckDeps) {
    this.deps = deps;
  }

  async check(renders: { front: string; side: string }, budget: BudgetTracker, signal: AbortSignal): Promise<AvatarCheck> {
    acquire(this.deps.rateLimiter, MUSE_SPARK_MODEL);
    const result = await callModelWithImage<unknown>({
      model: MUSE_SPARK_MODEL,
      prompt: AVATAR_CHECK_PROMPT,
      schemaName: "avatar_check",
      schema: AvatarCheckJsonSchema,
      images: [{ dataUrl: renders.front }, { dataUrl: renders.side }],
      signal,
      retryPolicy: this.deps.retryPolicy,
      fetch: this.deps.fetch,
      reasoningEffort: "low",
    });
    this.deps.onTokens(result.tokens.total, budget);
    const draft = AvatarCheckDraft.safeParse(result.data);
    if (!draft.success) {
      throw new ModelError("invalid_response", { model: MUSE_SPARK_MODEL });
    }
    return draft.data;
  }
}

export class FakeAvatarCheckService implements AvatarCheckService {
  async check(): Promise<AvatarCheck> {
    return { usable: true, issue: "", faceFound: false, leftEyeX: 0.5, leftEyeY: 0.5, rightEyeX: 0.5, rightEyeY: 0.5, mouthX: 0.5, mouthY: 0.5 };
  }
}
