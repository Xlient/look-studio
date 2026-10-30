import { z } from "zod";
import { envNumber } from "../env.ts";
import { parseRetryAfterMs } from "./model-errors.ts";
import type { FetchFn } from "./model-client.ts";

export const MESHY_BASE_URL = "https://api.meshy.ai/openapi/v1";

export type MeshyTaskKind = "image-to-3d" | "rigging";
export type MeshyErrorKind = "rate_limited" | "auth" | "no_credits" | "rejected" | "pose_failed" | "unavailable" | "timeout" | "aborted";

export class MeshyError extends Error {
  readonly kind: MeshyErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: MeshyErrorKind, status: number | null = null, retryAfterMs: number | null = null) {
    super(status === null ? `meshy_${kind}` : `meshy_${kind} (status ${status})`);
    this.name = "MeshyError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export const MeshyTaskStatus = z.enum(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"]);
export type MeshyTaskStatus = z.infer<typeof MeshyTaskStatus>;

export const MeshyTask = z.object({
  id: z.string().min(1),
  status: MeshyTaskStatus,
  progress: z.number().min(0).max(100).catch(0),
  model_urls: z.object({ glb: z.string().url().optional() }).partial().optional(),
  result: z.object({ rigged_character_glb_url: z.string().optional() }).partial().nullable().optional(),
  task_error: z.object({ message: z.string().optional() }).partial().nullable().optional(),
});
export type MeshyTask = z.infer<typeof MeshyTask>;

const Created = z.object({ result: z.string().min(1) });

export function meshyTimeoutMs(): number {
  return envNumber("MESHY_TIMEOUT_MS", 30_000);
}

export function mapMeshyStatus(status: number, retryAfter: string | null): MeshyError {
  switch (status) {
    case 429:
      return new MeshyError("rate_limited", status, parseRetryAfterMs(retryAfter));
    case 401:
      return new MeshyError("auth", status);
    case 402:
      return new MeshyError("no_credits", status);
    case 400:
    case 403:
      return new MeshyError("rejected", status);
    case 422:
      return new MeshyError("pose_failed", status);
    default:
      return new MeshyError("unavailable", status);
  }
}

export interface MeshyClient {
  createImageTo3d(imageDataUrl: string, texturePrompt: string, signal: AbortSignal): Promise<string>;
  createRigging(imageTaskId: string, signal: AbortSignal): Promise<string>;
  getTask(kind: MeshyTaskKind, id: string, signal: AbortSignal): Promise<MeshyTask>;
  deleteTask(kind: MeshyTaskKind, id: string, signal: AbortSignal): Promise<void>;
}

export function createMeshyClient(apiKey: string, fetchFn: FetchFn = fetch): MeshyClient {
  const request = async (method: string, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> => {
    const timeout = AbortSignal.timeout(meshyTimeoutMs());
    let response: Response;
    try {
      response = await fetchFn(`${MESHY_BASE_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch {
      throw new MeshyError(signal.aborted ? "aborted" : timeout.aborted ? "timeout" : "unavailable");
    }
    if (!response.ok) {
      throw mapMeshyStatus(response.status, response.headers.get("retry-after"));
    }
    const text = await response.text();
    try {
      return text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      throw new MeshyError("unavailable", response.status);
    }
  };

  const created = (value: unknown): string => {
    const parsed = Created.safeParse(value);
    if (!parsed.success) {
      throw new MeshyError("unavailable");
    }
    return parsed.data.result;
  };

  return {
    async createImageTo3d(imageDataUrl, texturePrompt, signal) {
      return created(
        await request("POST", "/image-to-3d", signal, {
          image_url: imageDataUrl,
          ai_model: "latest",
          pose_mode: "a-pose",
          should_remesh: true,
          topology: "quad",
          target_polycount: 30_000,
          should_texture: true,
          texture_prompt: texturePrompt,
          moderation: true,
          target_formats: ["glb"],
        }),
      );
    },
    async createRigging(imageTaskId, signal) {
      return created(await request("POST", "/rigging", signal, { input_task_id: imageTaskId, height_meters: 1.7 }));
    },
    async getTask(kind, id, signal) {
      const parsed = MeshyTask.safeParse(await request("GET", `/${kind}/${encodeURIComponent(id)}`, signal));
      if (!parsed.success) {
        throw new MeshyError("unavailable");
      }
      return parsed.data;
    },
    async deleteTask(kind, id, signal) {
      await request("DELETE", `/${kind}/${encodeURIComponent(id)}`, signal);
    },
  };
}
