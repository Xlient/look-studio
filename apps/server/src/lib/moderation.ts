import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { ModerationDraft, ModerationDraftJsonSchema, buildModerationPrompt } from "./avatar-prompts.ts";
import type { ModerationCategory, ModerationDraft as ModerationDraftType } from "./avatar-prompts.ts";
import { callModelStructured } from "./model-client.ts";
import type { FetchFn } from "./model-client.ts";
import { ModelError } from "./model-errors.ts";
import { MUSE_SPARK_MODEL, acquire } from "./muse-services.ts";

export interface ModerationResult {
  allowed: boolean;
  category: ModerationCategory;
}

export interface ModerationService {
  check(text: string, signal: AbortSignal, budget: BudgetTracker): Promise<ModerationResult>;
}

// Fail closed: a block wins over a contradictory category.
export function toVerdict(draft: ModerationDraftType): ModerationResult {
  const allowed = draft.allowed && draft.category === "ok";
  return { allowed, category: allowed ? "ok" : draft.category === "ok" ? "other_unsafe" : draft.category };
}

export class AllowAllModeration implements ModerationService {
  async check(): Promise<ModerationResult> {
    return { allowed: true, category: "ok" };
  }
}

export interface ModerationDeps {
  readonly retryPolicy: RetryPolicy;
  readonly rateLimiter: RateLimiter;
  readonly onTokens: (total: number, budget: BudgetTracker) => void;
  readonly fetch?: FetchFn;
}

export class MuseModeration implements ModerationService {
  private readonly deps: ModerationDeps;

  constructor(deps: ModerationDeps) {
    this.deps = deps;
  }

  async check(text: string, signal: AbortSignal, budget: BudgetTracker): Promise<ModerationResult> {
    acquire(this.deps.rateLimiter, MUSE_SPARK_MODEL);
    const result = await callModelStructured<unknown>({
      model: MUSE_SPARK_MODEL,
      prompt: buildModerationPrompt(text),
      schemaName: "moderation",
      schema: ModerationDraftJsonSchema,
      signal,
      retryPolicy: this.deps.retryPolicy,
      fetch: this.deps.fetch,
      reasoningEffort: "minimal",
    });
    this.deps.onTokens(result.tokens.total, budget);
    const draft = ModerationDraft.safeParse(result.data);
    if (!draft.success) {
      throw new ModelError("invalid_response", { model: MUSE_SPARK_MODEL });
    }
    return toVerdict(draft.data);
  }
}
