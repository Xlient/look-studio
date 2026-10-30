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
  build(image: string, description: string, signal: AbortSignal, onProgress: (stage: BuildStage, progress: number) => void): Promise<AvatarBuild>;
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

  private retry<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return this.deps.retryPolicy.run(run, { signal, shouldRetry: isRetryable });
  }

  private async waitFor(kind: MeshyTaskKind, id: string, signal: AbortSignal, onProgress: (progress: number) => void): Promise<MeshyTask> {
    const pollMs = this.deps.pollMs ?? envNumber("MESHY_POLL_MS", 3_000);
    const deadline = this.deps.now() + (this.deps.maxWaitMs ?? envNumber("MESHY_MAX_WAIT_MS", 15 * 60_000));
    for (;;) {
      const task = await this.retry(() => this.deps.client.getTask(kind, id, signal), signal);
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

  async build(image: string, description: string, signal: AbortSignal, onProgress: (stage: BuildStage, progress: number) => void): Promise<AvatarBuild> {
    const created: [MeshyTaskKind, string][] = [];
    try {
      const modelId = await this.retry(() => this.deps.client.createImageTo3d(image, buildTexturePrompt(description), signal), signal);
      created.push(["image-to-3d", modelId]);
      await this.waitFor("image-to-3d", modelId, signal, (progress) => onProgress("modeling", progress));
      const rigId = await this.retry(() => this.deps.client.createRigging(modelId, signal), signal);
      created.push(["rigging", rigId]);
      const rigged = await this.waitFor("rigging", rigId, signal, (progress) => onProgress("rigging", progress));
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
