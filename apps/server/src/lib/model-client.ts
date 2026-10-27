import OpenAI from "openai";
import type { RetryPolicy } from "@look-studio/shared";
import { envNumber, requiredEnv } from "../env.ts";
import { logInfo } from "./logger.ts";
import { ModelError, toModelError } from "./model-errors.ts";
import { BACKOFF_BASE_MS, ExponentialBackoffRetryPolicy } from "./retry-policy.ts";

export const MODEL_API_BASE_URL = "https://api.meta.ai/v1";

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function modelTimeoutMs(): number {
  return envNumber("MODEL_TIMEOUT_MS", 30_000);
}

export function modelMaxRetries(): number {
  return envNumber("MODEL_MAX_RETRIES", 3);
}

export const defaultRetryPolicy: RetryPolicy = new ExponentialBackoffRetryPolicy(() => ({
  maxRetries: modelMaxRetries(),
  baseMs: BACKOFF_BASE_MS,
}));

function toTokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 0;
}

export function createModelClient(overrides: { fetch?: FetchFn } = {}): OpenAI {
  return new OpenAI({
    apiKey: requiredEnv("MODEL_API_KEY"),
    baseURL: MODEL_API_BASE_URL,
    timeout: modelTimeoutMs(),
    maxRetries: 0,
    fetch: overrides.fetch,
  });
}

export interface StructuredCallOptions {
  model: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  retryPolicy: RetryPolicy;
  timeoutMs?: number;
  fetch?: FetchFn;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface StructuredCallResult<T> {
  data: T;
  latencyMs: number;
  tokens: TokenUsage;
  requestId: string | null;
  model: string;
  attempts: number;
}

interface TextPart {
  type: "input_text";
  text: string;
}

interface ImagePart {
  type: "input_image";
  image_url: string;
  detail: "auto";
}

interface UserMessage {
  role: "user";
  content: (TextPart | ImagePart)[];
}

function buildInput(prompt: string, imageUrls: string[]): string | UserMessage[] {
  if (imageUrls.length === 0) {
    return prompt;
  }
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...imageUrls.map((image_url): ImagePart => ({ type: "input_image", image_url, detail: "auto" })),
      ],
    },
  ];
}

async function executeStructured<T>(args: {
  client: OpenAI;
  model: string;
  prompt: string;
  imageUrls: string[];
  schemaName: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  parseOutput: (outputText: string) => T;
}): Promise<StructuredCallResult<T>> {
  const startedAt = Date.now();
  let attempts = 0;
  try {
    const completed = await args.retryPolicy.run(async () => {
      attempts += 1;
      try {
        const response = await args.client.responses.create(
          {
            model: args.model,
            input: buildInput(args.prompt, args.imageUrls),
            text: {
              format: {
                type: "json_schema",
                name: args.schemaName,
                schema: args.schema,
                strict: true,
              },
            },
          },
          { timeout: args.timeoutMs, signal: args.signal },
        );
        const outputText = response.output_text;
        if (typeof outputText !== "string") {
          throw new ModelError("invalid_response", { model: args.model });
        }
        return {
          data: args.parseOutput(outputText),
          tokens: {
            input: toTokenCount(response.usage?.input_tokens),
            output: toTokenCount(response.usage?.output_tokens),
            total: toTokenCount(response.usage?.total_tokens),
          },
          requestId: typeof response.id === "string" ? response.id : null,
        };
      } catch (error) {
        throw toModelError(error, args.model, args.signal);
      }
    }, {
      signal: args.signal,
      shouldRetry: (error) => error instanceof ModelError && error.kind === "rate_limited",
    });
    const latencyMs = Date.now() - startedAt;
    logInfo({
      event: "model_call",
      model: args.model,
      latencyMs,
      inputTokens: completed.tokens.input,
      outputTokens: completed.tokens.output,
      totalTokens: completed.tokens.total,
      requestId: completed.requestId,
      attempts,
    });
    return { ...completed, latencyMs, model: args.model, attempts };
  } catch (error) {
    const typed = toModelError(error, args.model, args.signal);
    logInfo({
      event: "model_call_error",
      model: args.model,
      latencyMs: Date.now() - startedAt,
      error: typed.kind,
      status: typed.status,
      attempts,
    });
    throw typed;
  }
}

export async function callModelStructured<T>(
  options: StructuredCallOptions,
): Promise<StructuredCallResult<T>> {
  const client = createModelClient({ fetch: options.fetch });
  return executeStructured<T>({
    client,
    model: options.model,
    prompt: options.prompt,
    imageUrls: [],
    schemaName: options.schemaName,
    schema: options.schema,
    signal: options.signal,
    retryPolicy: options.retryPolicy,
    timeoutMs: options.timeoutMs ?? modelTimeoutMs(),
    parseOutput: (outputText) => JSON.parse(outputText) as T,
  });
}

export interface JsonCallOptions<T> extends StructuredCallOptions {
  parse: (data: unknown) => T;
}

export async function callModelJson<T>(options: JsonCallOptions<T>): Promise<StructuredCallResult<T>> {
  const client = createModelClient({ fetch: options.fetch });
  return executeStructured<T>({
    client,
    model: options.model,
    prompt: options.prompt,
    imageUrls: [],
    schemaName: options.schemaName,
    schema: options.schema,
    signal: options.signal,
    retryPolicy: options.retryPolicy,
    timeoutMs: options.timeoutMs ?? modelTimeoutMs(),
    parseOutput: (outputText) => {
      const data: unknown = JSON.parse(outputText);
      try {
        return options.parse(data);
      } catch (error) {
        if (error instanceof ModelError) {
          throw error;
        }
        throw new ModelError("invalid_response", { model: options.model });
      }
    },
  });
}

export interface ImageInput {
  dataUrl: string;
}

export interface ImageCallOptions extends StructuredCallOptions {
  images: ImageInput[];
}

export async function callModelWithImage<T>(options: ImageCallOptions): Promise<StructuredCallResult<T>> {
  const client = createModelClient({ fetch: options.fetch });
  return executeStructured<T>({
    client,
    model: options.model,
    prompt: options.prompt,
    imageUrls: options.images.map((image) => image.dataUrl),
    schemaName: options.schemaName,
    schema: options.schema,
    signal: options.signal,
    retryPolicy: options.retryPolicy,
    timeoutMs: options.timeoutMs ?? modelTimeoutMs(),
    parseOutput: (outputText) => JSON.parse(outputText) as T,
  });
}
