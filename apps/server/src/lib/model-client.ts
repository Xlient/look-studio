import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import type { RetryOptions, RetryPolicy } from "@look-studio/shared";
import { envNumber, requiredEnv } from "../env.ts";
import { logInfo } from "./logger.ts";

export const MODEL_API_BASE_URL = "https://api.meta.ai/v1";
export const BACKOFF_BASE_MS = 500;

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function modelTimeoutMs(): number {
  return envNumber("MODEL_TIMEOUT_MS", 30_000);
}

export function modelMaxRetries(): number {
  return envNumber("MODEL_MAX_RETRIES", 3);
}

export function computeBackoffMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs: number = BACKOFF_BASE_MS,
): number {
  return baseMs * 2 ** attempt + random() * baseMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryPolicyConfig {
  maxRetries: number;
  baseMs: number;
}

export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  private readonly config: () => RetryPolicyConfig;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    config: () => RetryPolicyConfig = () => ({ maxRetries: modelMaxRetries(), baseMs: BACKOFF_BASE_MS }),
    wait: (ms: number) => Promise<void> = sleep,
    random: () => number = Math.random,
  ) {
    this.config = config;
    this.wait = wait;
    this.random = random;
  }

  async run<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { maxRetries, baseMs } = this.config();
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        return await fn();
      } catch (error) {
        const retry = attempt < maxRetries && (options.shouldRetry?.(error) ?? false);
        if (!retry) {
          throw error;
        }
        const backoffMs = computeBackoffMs(attempt, this.random, baseMs);
        await this.delay(Math.max(backoffMs, errorRetryAfterMs(error) ?? 0), options.signal);
      }
    }
  }

  private delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (ms <= 0 || signal?.aborted) {
      return Promise.resolve();
    }
    const active = signal;
    if (active === undefined) {
      return this.wait(ms);
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          active.removeEventListener("abort", done);
          resolve();
        }
      };
      active.addEventListener("abort", done, { once: true });
      void this.wait(ms).then(done, done);
    });
  }
}

export const defaultRetryPolicy: RetryPolicy = new ExponentialBackoffRetryPolicy();

export type ModelErrorKind =
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "aborted"
  | "auth"
  | "unavailable";

export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly model: string;

  constructor(
    kind: ModelErrorKind,
    fields: { model: string; status?: number | null; retryAfterMs?: number | null },
  ) {
    const status = fields.status ?? null;
    super(status === null ? kind : `${kind} (status ${status})`);
    this.name = "ModelError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = fields.retryAfterMs ?? null;
    this.model = fields.model;
  }
}

export function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return seconds * 1000;
}

function errorRetryAfterMs(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "retryAfterMs" in error) {
    const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function toModelError(error: unknown, model: string, signal: AbortSignal | undefined): ModelError {
  if (error instanceof ModelError) {
    return error;
  }
  if (signal?.aborted || error instanceof APIUserAbortError) {
    return new ModelError("aborted", { model });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelError("timeout", { model });
  }
  if (error instanceof APIError) {
    const status = error.status ?? null;
    if (error.status === 429) {
      return new ModelError("rate_limited", {
        model,
        status,
        retryAfterMs: parseRetryAfterMs(error.headers?.get("retry-after")),
      });
    }
    if (error.status === 401 || error.status === 403) {
      return new ModelError("auth", { model, status });
    }
    return new ModelError("unavailable", { model, status });
  }
  if (error instanceof SyntaxError) {
    return new ModelError("invalid_response", { model });
  }
  return new ModelError("unavailable", { model });
}

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
