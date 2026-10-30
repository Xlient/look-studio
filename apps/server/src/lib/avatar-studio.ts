import { AVATAR_CONCEPT_COUNT } from "@look-studio/shared";
import type { AvatarConcept, AvatarJobStatus, BudgetTracker, JobQueue } from "@look-studio/shared";
import { logInfo } from "./logger.ts";
import type { LogValue } from "./logger.ts";
import type { AvatarBuild, AvatarModelProvider, BuildStage } from "./meshy-avatar.ts";
import { MeshyError } from "./meshy-client.ts";
import type { FetchFn } from "./model-client.ts";
import type { ModerationCategory } from "./avatar-prompts.ts";
import type { ModerationService } from "./moderation.ts";
import type { ConceptService } from "./muse-image.ts";

const CONCEPT_TTL_MS = 30 * 60_000;
const MAX_CONCEPTS = 60;
const JOB_TIMEOUT_MS = 20 * 60_000;
const JOB_TTL_MS = 60 * 60_000;
const MODEL_RETAIN_MS = 15 * 60_000;
const MAX_HELD_MODELS = 5;
const MODELING_SHARE = 0.75;

export class AvatarBlockedError extends Error {
  readonly category: ModerationCategory;

  constructor(category: ModerationCategory) {
    super("avatar_blocked");
    this.name = "AvatarBlockedError";
    this.category = category;
  }
}

export function overallProgress(stage: BuildStage, progress: number): number {
  const clamped = Math.min(100, Math.max(0, progress)) / 100;
  const share = stage === "modeling" ? clamped * MODELING_SHARE : MODELING_SHARE + clamped * (1 - MODELING_SHARE);
  return Math.round(share * 99);
}

export function failureMessage(error: unknown): string {
  if (error instanceof MeshyError) {
    switch (error.kind) {
      case "pose_failed":
        return "Meshy couldn't find a humanoid pose to rig. Try a different concept.";
      case "rejected":
        return "Meshy couldn't build this character. Try a different concept.";
      case "no_credits":
        return "The 3D service is out of credits.";
      case "rate_limited":
        return "The 3D service is busy. Try again in a minute.";
      default:
        return "The 3D service is unavailable. Try again later.";
    }
  }
  return "Something went wrong building the avatar.";
}

export interface AvatarClient {
  readonly key: string;
  readonly budget: BudgetTracker;
}

interface StoredConcept {
  owner: string;
  image: string;
  description: string;
  expiresAt: number;
}

interface AvatarJob {
  owner: string;
  createdAt: number;
  status: AvatarJobStatus;
  build: AvatarBuild | null;
  model: { bytes: ArrayBuffer; expiresAt: number } | null;
  listeners: Set<(status: AvatarJobStatus) => void>;
}

export interface AvatarStudioDeps {
  readonly moderation: ModerationService;
  readonly concepts: ConceptService;
  readonly provider: AvatarModelProvider;
  readonly queue: JobQueue;
  readonly now: () => number;
  readonly newId: () => string;
  readonly onAvatarBuilt: (budget: BudgetTracker) => void;
  readonly fetch?: FetchFn;
}

export interface AvatarService {
  createConcepts(description: string, photo: string | undefined, client: AvatarClient, signal: AbortSignal): Promise<AvatarConcept[]>;
  startJob(conceptId: string, client: AvatarClient): string | null;
  getJob(jobId: string, owner: string): AvatarJobStatus | null;
  subscribe(jobId: string, emit: (status: AvatarJobStatus) => Promise<void>, signal: AbortSignal): Promise<void>;
  fetchModel(jobId: string, owner: string, signal: AbortSignal): Promise<Response | null>;
}

const modelResponse = (bytes: ArrayBuffer) =>
  new Response(bytes, { headers: { "content-type": "model/gltf-binary", "cache-control": "no-store" } });

const isTerminal = (status: AvatarJobStatus) => status.stage === "ready" || status.stage === "failed";

export class AvatarStudio implements AvatarService {
  private readonly deps: AvatarStudioDeps;
  private readonly concepts = new Map<string, StoredConcept>();
  private readonly jobs = new Map<string, AvatarJob>();

  constructor(deps: AvatarStudioDeps) {
    this.deps = deps;
  }

  private prune(): void {
    const now = this.deps.now();
    for (const [id, concept] of this.concepts) {
      if (concept.expiresAt <= now) {
        this.concepts.delete(id);
      }
    }
    for (const [id, job] of this.jobs) {
      if (job.createdAt + JOB_TTL_MS <= now && isTerminal(job.status)) {
        this.jobs.delete(id);
        void job.build?.cleanup(AbortSignal.timeout(10_000));
      }
    }
    const held = [...this.jobs].filter(([, job]) => job.model !== null);
    held.forEach(([id, job], index) => {
      if ((job.model?.expiresAt ?? now) <= now || index < held.length - MAX_HELD_MODELS) {
        this.jobs.delete(id);
      }
    });
    while (this.concepts.size > MAX_CONCEPTS) {
      const oldest = this.concepts.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.concepts.delete(oldest);
    }
  }

  async createConcepts(description: string, photo: string | undefined, client: AvatarClient, signal: AbortSignal): Promise<AvatarConcept[]> {
    const startedAt = this.deps.now();
    const logConcepts = (outcome: string, moderationMs: number | null, count: number) =>
      logInfo({ event: "avatar_concepts", durationMs: this.deps.now() - startedAt, moderationMs, count, outcome });
    let moderationMs: number | null = null;
    let images: string[];
    try {
      const verdict = await this.deps.moderation.check(description, signal, client.budget);
      moderationMs = this.deps.now() - startedAt;
      if (!verdict.allowed) {
        logConcepts("blocked", moderationMs, 0);
        throw new AvatarBlockedError(verdict.category);
      }
      images = await this.deps.concepts.createConcepts({ description, budget: client.budget, ...(photo === undefined ? {} : { photo }) }, signal);
    } catch (error) {
      if (!(error instanceof AvatarBlockedError)) {
        logConcepts("error", moderationMs, 0);
      }
      throw error;
    }
    logConcepts("ok", moderationMs, images.length);
    this.prune();
    const expiresAt = this.deps.now() + CONCEPT_TTL_MS;
    return images.slice(0, AVATAR_CONCEPT_COUNT).map((image) => {
      const id = `concept-${this.deps.newId()}`;
      this.concepts.set(id, { owner: client.key, image, description, expiresAt });
      return { id, image };
    });
  }

  private update(job: AvatarJob, status: AvatarJobStatus): void {
    job.status = status;
    for (const listener of job.listeners) {
      listener(status);
    }
  }

  startJob(conceptId: string, client: AvatarClient): string | null {
    this.prune();
    const concept = this.concepts.get(conceptId);
    if (concept === undefined || concept.owner !== client.key) {
      return null;
    }
    this.concepts.delete(conceptId);
    const jobId = `avatar-${this.deps.newId()}`;
    const job: AvatarJob = {
      owner: client.key,
      createdAt: this.deps.now(),
      status: { jobId, stage: "queued", progress: 0 },
      build: null,
      model: null,
      listeners: new Set(),
    };
    this.jobs.set(jobId, job);
    const totalMs = () => this.deps.now() - job.createdAt;
    const queued = this.deps.queue.enqueue(
      (signal) => {
        logInfo({ event: "avatar_job_started", jobId, queuedMs: totalMs() });
        return this.deps.provider.build(
          concept.image,
          concept.description,
          signal,
          (stage, progress) => this.update(job, { jobId, stage, progress: overallProgress(stage, progress) }),
          jobId,
        );
      },
      { timeoutMs: JOB_TIMEOUT_MS },
    );
    queued.result.then(
      (build) => {
        job.build = build;
        logInfo({ event: "avatar_job_ready", jobId, totalMs: totalMs() });
        this.deps.onAvatarBuilt(client.budget);
        this.update(job, { jobId, stage: "ready", progress: 100 });
      },
      (error: unknown) => {
        logInfo({ event: "avatar_job_failed", jobId, totalMs: totalMs(), error: error instanceof MeshyError ? error.kind : "unknown" });
        this.update(job, { jobId, stage: "failed", progress: job.status.progress, error: failureMessage(error) });
      },
    );
    return jobId;
  }

  getJob(jobId: string, owner: string): AvatarJobStatus | null {
    const job = this.jobs.get(jobId);
    return job !== undefined && job.owner === owner ? job.status : null;
  }

  async subscribe(jobId: string, emit: (status: AvatarJobStatus) => Promise<void>, signal: AbortSignal): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return;
    }
    // A failed write means the client disconnected, which ends the subscription like an abort.
    await new Promise<void>((resolve) => {
      let writes = emit(job.status);
      const done = () => {
        job.listeners.delete(listener);
        signal.removeEventListener("abort", done);
        void writes.then(resolve, resolve);
      };
      const listener = (status: AvatarJobStatus) => {
        writes = writes.then(() => emit(status));
        if (isTerminal(status)) {
          done();
        }
      };
      if (isTerminal(job.status) || signal.aborted) {
        void writes.then(resolve, resolve);
        return;
      }
      job.listeners.add(listener);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  async fetchModel(jobId: string, owner: string, signal: AbortSignal): Promise<Response | null> {
    this.prune();
    const job = this.jobs.get(jobId);
    if (job === undefined || job.owner !== owner) {
      return null;
    }
    const logFetch = (first: boolean, fields: Record<string, LogValue>) =>
      logInfo({ event: "avatar_model_fetch", jobId, first, ...fields });
    if (job.model !== null) {
      logFetch(false, { status: "ok", bytes: job.model.bytes.byteLength });
      return modelResponse(job.model.bytes);
    }
    const build = job.build;
    if (build === null) {
      return null;
    }
    const fetchStartedAt = this.deps.now();
    let bytes: ArrayBuffer;
    try {
      const response = await (this.deps.fetch ?? fetch)(build.glbUrl, { signal });
      if (!response.ok || response.body === null) {
        throw new MeshyError("unavailable", response.status);
      }
      bytes = await response.arrayBuffer();
    } catch (error) {
      logFetch(true, { status: "error", fetchMs: this.deps.now() - fetchStartedAt, error: error instanceof MeshyError ? error.kind : "unknown" });
      throw error;
    }
    const cleanupStartedAt = this.deps.now();
    job.build = null;
    // Meshy's copy is deleted next, so a browser that loses this download can only retry from here.
    job.model = { bytes, expiresAt: this.deps.now() + MODEL_RETAIN_MS };
    this.prune();
    await build.cleanup(AbortSignal.timeout(10_000));
    logFetch(true, { status: "ok", bytes: bytes.byteLength, fetchMs: cleanupStartedAt - fetchStartedAt, cleanupMs: this.deps.now() - cleanupStartedAt });
    return modelResponse(bytes);
  }
}
