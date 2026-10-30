import { APIError, toFile } from "openai";
import type OpenAI from "openai";
import { AVATAR_CONCEPT_COUNT, AvatarImage } from "@look-studio/shared";
import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { envNumber } from "../env.ts";
import { buildConceptPrompt } from "./avatar-prompts.ts";
import { logInfo } from "./logger.ts";
import { ModelError, toModelError } from "./model-errors.ts";

export const MUSE_IMAGE_MODEL = "muse-image-1.0";
export const MUSE_IMAGE_PRICE_USD = 0.01;
const CONCEPT_SIZE = "1024x1536";

export function imageTimeoutMs(): number {
  return envNumber("IMAGE_TIMEOUT_MS", 120_000);
}

export class ContentBlockedError extends Error {
  constructor() {
    super("content_blocked");
    this.name = "ContentBlockedError";
  }
}

export interface ConceptRequest {
  description: string;
  photo?: string;
  budget: BudgetTracker;
}

export interface ConceptService {
  createConcepts(request: ConceptRequest, signal: AbortSignal): Promise<string[]>;
}

export interface ImageDeps {
  readonly client: OpenAI;
  readonly retryPolicy: RetryPolicy;
  readonly rateLimiter: RateLimiter;
  readonly onImages: (count: number, budget: BudgetTracker) => void;
}

function dataUrlParts(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new ModelError("invalid_response", { model: MUSE_IMAGE_MODEL });
  }
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

export function toConceptImages(data: readonly { b64_json?: string | null }[] | undefined, format: string): string[] {
  const images = (data ?? [])
    .map((item) => (typeof item.b64_json === "string" ? `data:image/${format};base64,${item.b64_json}` : ""))
    .filter((image) => AvatarImage.safeParse(image).success);
  if (images.length === 0) {
    throw new ModelError("invalid_response", { model: MUSE_IMAGE_MODEL });
  }
  return images;
}

const isRetryable = (error: unknown) =>
  error instanceof ModelError && (error.kind === "rate_limited" || (error.kind === "unavailable" && error.status === 503));

export class MuseImageConceptService implements ConceptService {
  private readonly deps: ImageDeps;

  constructor(deps: ImageDeps) {
    this.deps = deps;
  }

  async createConcepts(request: ConceptRequest, signal: AbortSignal): Promise<string[]> {
    const decision = this.deps.rateLimiter.tryAcquire(MUSE_IMAGE_MODEL, AVATAR_CONCEPT_COUNT);
    if (!decision.allowed) {
      throw new ModelError("rate_limited", { model: MUSE_IMAGE_MODEL, retryAfterMs: decision.retryAfterMs });
    }
    const startedAt = Date.now();
    const prompt = buildConceptPrompt(request.description, request.photo !== undefined);
    const common = {
      model: MUSE_IMAGE_MODEL,
      prompt,
      n: AVATAR_CONCEPT_COUNT,
      size: CONCEPT_SIZE,
      response_format: "b64_json",
      output_format: "webp",
    } as const;
    const options = { timeout: imageTimeoutMs(), signal };
    try {
      const response = await this.deps.retryPolicy.run(
        async () => {
          try {
            if (request.photo === undefined) {
              return await this.deps.client.images.generate(common, options);
            }
            const photo = dataUrlParts(request.photo);
            const image = await toFile(photo.bytes, `reference.${photo.mime.split("/")[1] ?? "png"}`, { type: photo.mime });
            return await this.deps.client.images.edit({ ...common, image }, options);
          } catch (error) {
            if (error instanceof APIError && error.code === "content_policy_violation") {
              throw new ContentBlockedError();
            }
            throw toModelError(error, MUSE_IMAGE_MODEL, signal);
          }
        },
        { signal, shouldRetry: isRetryable },
      );
      const images = toConceptImages(response.data, "webp");
      this.deps.onImages(images.length, request.budget);
      logInfo({ event: "model_call", model: MUSE_IMAGE_MODEL, latencyMs: Date.now() - startedAt, images: images.length });
      return images;
    } catch (error) {
      if (error instanceof ContentBlockedError) {
        logInfo({ event: "model_call_blocked", model: MUSE_IMAGE_MODEL, latencyMs: Date.now() - startedAt });
        throw error;
      }
      const typed = toModelError(error, MUSE_IMAGE_MODEL, signal);
      logInfo({ event: "model_call_error", model: MUSE_IMAGE_MODEL, latencyMs: Date.now() - startedAt, error: typed.kind, status: typed.status });
      throw typed;
    }
  }
}
