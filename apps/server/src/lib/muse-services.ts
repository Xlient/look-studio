import type { EditBatch, LookSpec, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { EditBatchDraft, EditBatchDraftJsonSchema, buildEditPrompt, draftsToEditBatch } from "./edit-draft.ts";
import { LookDraft, LookDraftJsonSchema, buildLookPrompt, draftToLookSpec } from "./look-draft.ts";
import { envString } from "../env.ts";
import { ReasoningEffort, callModelStructured, callModelWithImage } from "./model-client.ts";
import type { FetchFn, StructuredCallResult } from "./model-client.ts";
import { ModelError } from "./model-errors.ts";
import { createFieldStreamer } from "./partial-json.ts";
import { EditUnresolvedError } from "./services.ts";
import type {
  EditRequest,
  EditService,
  LookRequest,
  LookService,
  ModelCallMeta,
  ServiceResult,
} from "./services.ts";
import { estimateCostUsd } from "./spend-cap.ts";

// Standard-mode model approved for inputs that may contain a face.
export const MUSE_SPARK_MODEL = "muse-spark-1.3";

// Muse Spark reasons for ~1,500 tokens by default before any visible text, which stalls streaming.
export function lookReasoningEffort(): ReasoningEffort {
  const parsed = ReasoningEffort.safeParse(envString("LOOK_REASONING_EFFORT", "low"));
  if (!parsed.success) {
    throw new Error("LOOK_REASONING_EFFORT must be minimal, low, medium, or high");
  }
  return parsed.data;
}

export interface MuseServiceDeps {
  readonly retryPolicy: RetryPolicy;
  readonly rateLimiter: RateLimiter;
  readonly newId: () => string;
  readonly fetch?: FetchFn;
}

export function acquire(limiter: RateLimiter, model: string): void {
  const decision = limiter.tryAcquire(model, 1);
  if (!decision.allowed) {
    throw new ModelError("rate_limited", { model, retryAfterMs: decision.retryAfterMs });
  }
}

function toMeta(result: StructuredCallResult<unknown>): ModelCallMeta {
  return {
    model: result.model,
    latencyMs: result.latencyMs,
    tokens: result.tokens,
    requestId: result.requestId,
    attempts: result.attempts,
  };
}

export class MuseLookService implements LookService {
  private readonly deps: MuseServiceDeps;

  constructor(deps: MuseServiceDeps) {
    this.deps = deps;
  }

  async createLook(
    request: LookRequest,
    signal: AbortSignal,
    onDescription?: (text: string) => void,
  ): Promise<ServiceResult<LookSpec>> {
    acquire(this.deps.rateLimiter, MUSE_SPARK_MODEL);
    const options = {
      model: MUSE_SPARK_MODEL,
      prompt: buildLookPrompt(request.chat, request.image !== undefined),
      schemaName: "look_draft",
      schema: LookDraftJsonSchema,
      signal,
      retryPolicy: this.deps.retryPolicy,
      fetch: this.deps.fetch,
      reasoningEffort: lookReasoningEffort(),
      ...(onDescription === undefined ? {} : { onTextDelta: createFieldStreamer("description", onDescription) }),
    };
    const result =
      request.image === undefined
        ? await callModelStructured<unknown>(options)
        : await callModelWithImage<unknown>({ ...options, images: [{ dataUrl: request.image }] });
    request.budget.record(estimateCostUsd(result.tokens.total));
    const draft = LookDraft.safeParse(result.data);
    const look = draft.success ? draftToLookSpec(draft.data, `look-${this.deps.newId()}`) : null;
    if (look === null) {
      throw new ModelError("invalid_response", { model: MUSE_SPARK_MODEL });
    }
    return { data: look, meta: toMeta(result) };
  }
}

export class MuseEditService implements EditService {
  private readonly deps: MuseServiceDeps;

  constructor(deps: MuseServiceDeps) {
    this.deps = deps;
  }

  async edit(request: EditRequest, signal: AbortSignal): Promise<ServiceResult<EditBatch>> {
    acquire(this.deps.rateLimiter, MUSE_SPARK_MODEL);
    const result = await callModelStructured<unknown>({
      model: MUSE_SPARK_MODEL,
      prompt: buildEditPrompt(request.utterance, request.look),
      schemaName: "edit_batch",
      schema: EditBatchDraftJsonSchema,
      signal,
      retryPolicy: this.deps.retryPolicy,
      fetch: this.deps.fetch,
    });
    request.budget.record(estimateCostUsd(result.tokens.total));
    const draft = EditBatchDraft.safeParse(result.data);
    if (!draft.success) {
      throw new ModelError("invalid_response", { model: MUSE_SPARK_MODEL });
    }
    const batch = draftsToEditBatch(draft.data.edits, request.look, () => `${request.look.id}-w-${this.deps.newId()}`);
    if (batch === null) {
      throw new EditUnresolvedError();
    }
    return { data: batch, meta: toMeta(result) };
  }
}
