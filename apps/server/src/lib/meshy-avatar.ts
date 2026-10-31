import type { RetryPolicy } from "@look-studio/shared";
import { envNumber } from "../env.ts";
import { buildTexturePrompt } from "./avatar-prompts.ts";
import { logInfo } from "./logger.ts";
import { MeshyError } from "./meshy-client.ts";
import type { MeshyClient, MeshyTask, MeshyTaskKind } from "./meshy-client.ts";

export type BuildStage = "modeling" | "rigging";

export interface AvatarBuild {
  readonly glbUrl: string;
  cleanup(signal: AbortSignal): Promise<void>;
}

export interface AvatarModelProvider {
  build(image: string, description: string, signal: AbortSignal, onProgress: (stage: BuildStage, progress: number) => void, jobId?: string): Promise<AvatarBuild>;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new MeshyError("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MeshyError("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

export interface MeshyAvatarDeps {
  readonly client: MeshyClient;
  readonly retryPolicy: RetryPolicy;
  readonly sleep: Sleep;
  readonly now: () => number;
  readonly pollMs?: number;
  readonly maxWaitMs?: number;
}

const isRetryable = (error: unknown) =>
  error instanceof MeshyError && (error.kind === "rate_limited" || error.kind === "timeout" || (error.kind === "unavailable" && (error.status ?? 500) >= 500));

export class MeshyAvatarProvider implements AvatarModelProvider {
  private readonly deps: MeshyAvatarDeps;

  constructor(deps: MeshyAvatarDeps) {
    this.deps = deps;
  }

  private retry<T>(run: () => Promise<T>, signal: AbortSignal, jobId: string, call: string): Promise<T> {
    let attempt = 0;
    const shouldRetry = (error: unknown) => {
      const retryable = isRetryable(error);
      if (retryable) {
        attempt += 1;
        logInfo({ event: "avatar_meshy_retry", jobId, call, attempt, error: error instanceof MeshyError ? error.kind : "unknown" });
      }
      return retryable;
    };
    return this.deps.retryPolicy.run(run, { signal, shouldRetry });
  }

  private async waitFor(kind: MeshyTaskKind, id: string, signal: AbortSignal, jobId: string, onProgress: (progress: number) => void): Promise<MeshyTask> {
    const pollMs = this.deps.pollMs ?? envNumber("MESHY_POLL_MS", 3_000);
    const deadline = this.deps.now() + (this.deps.maxWaitMs ?? envNumber("MESHY_MAX_WAIT_MS", 15 * 60_000));
    for (;;) {
      const task = await this.retry(() => this.deps.client.getTask(kind, id, signal), signal, jobId, "get_task");
      if (task.status === "SUCCEEDED") {
        return task;
      }
      if (task.status === "FAILED" || task.status === "CANCELED") {
        throw new MeshyError("rejected");
      }
      onProgress(task.progress);
      if (this.deps.now() >= deadline) {
        throw new MeshyError("timeout");
      }
      await this.deps.sleep(pollMs, signal);
    }
  }

  private async remove(kind: MeshyTaskKind, id: string, signal: AbortSignal): Promise<void> {
    try {
      await this.deps.client.deleteTask(kind, id, signal);
    } catch (error) {
      logInfo({ event: "meshy_cleanup_error", kind, error: error instanceof MeshyError ? error.kind : "unknown" });
    }
  }

  private async runStage(stage: BuildStage, kind: MeshyTaskKind, create: () => Promise<string>, created: [MeshyTaskKind, string][], signal: AbortSignal, jobId: string, onProgress: (stage: BuildStage, progress: number) => void): Promise<MeshyTask & { id: string }> {
    const startedAt = this.deps.now();
    try {
      const id = await this.retry(create, signal, jobId, `create_${stage}`);
      created.push([kind, id]);
      const task = await this.waitFor(kind, id, signal, jobId, (progress) => onProgress(stage, progress));
      logInfo({ event: "avatar_stage", jobId, stage, durationMs: this.deps.now() - startedAt, status: task.status });
      return { ...task, id };
    } catch (error) {
      logInfo({ event: "avatar_stage", jobId, stage, durationMs: this.deps.now() - startedAt, status: "ERROR", error: error instanceof MeshyError ? error.kind : "unknown" });
      throw error;
    }
  }

  async build(image: string, description: string, signal: AbortSignal, onProgress: (stage: BuildStage, progress: number) => void, jobId = "none"): Promise<AvatarBuild> {
    const created: [MeshyTaskKind, string][] = [];
    try {
      const model = await this.runStage("modeling", "image-to-3d", () => this.deps.client.createImageTo3d(image, buildTexturePrompt(description), signal), created, signal, jobId, onProgress);
      const rigged = await this.runStage("rigging", "rigging", () => this.deps.client.createRigging(model.id, signal), created, signal, jobId, onProgress);
      const glbUrl = rigged.result?.rigged_character_glb_url ?? "";
      if (!glbUrl.startsWith("https://")) {
        throw new MeshyError("unavailable");
      }
      return {
        glbUrl,
        cleanup: async (cleanupSignal) => {
          for (const [kind, id] of created) {
            await this.remove(kind, id, cleanupSignal);
          }
        },
      };
    } catch (error) {
      const cleanupSignal = AbortSignal.timeout(10_000);
      for (const [kind, id] of created) {
        await this.remove(kind, id, cleanupSignal);
      }
      throw error;
    }
  }
}
