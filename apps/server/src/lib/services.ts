import type {
  CritiqueReport,
  EditCommand,
  LookSpec,
  WearableSpec,
} from "@look-studio/shared";

export interface ModelCallMeta {
  model: string;
  latencyMs: number;
  tokens: { input: number; output: number; total: number };
  requestId: string | null;
  attempts: number;
}

export interface ServiceResult<T> {
  data: T;
  meta: ModelCallMeta;
}

export class EditUnresolvedError extends Error {
  constructor() {
    super("edit_unresolved");
    this.name = "EditUnresolvedError";
  }
}

export const FAKE_META: ModelCallMeta = {
  model: "offline-fake",
  latencyMs: 0,
  tokens: { input: 0, output: 0, total: 0 },
  requestId: null,
  attempts: 0,
};

export interface LookRequest {
  chat: string;
  image?: string;
}

export interface LookService {
  createLook(request: LookRequest, signal: AbortSignal): Promise<ServiceResult<LookSpec>>;
}

export interface EditRequest {
  utterance: string;
  look: LookSpec;
}

export interface EditService {
  edit(request: EditRequest, signal: AbortSignal): Promise<ServiceResult<EditCommand>>;
}

export interface FitCheckRequest {
  stills: string[];
  wearableId: string;
}

export interface FitCheckService {
  check(request: FitCheckRequest): Promise<CritiqueReport>;
}

export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface JobStatus {
  jobId: string;
  state: JobState;
  progress?: { completed: number; total: number };
  error?: string;
}

export interface WearableService {
  createJob(spec: WearableSpec): Promise<string>;
  getJob(jobId: string): JobStatus | null;
  subscribe(
    jobId: string,
    emit: (status: JobStatus) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
}

export class FakeLookService implements LookService {
  async createLook(request: LookRequest): Promise<ServiceResult<LookSpec>> {
    void request;
    return { data: { id: "look-fake-1", name: "Fake look", wearables: [], style: "casual" }, meta: FAKE_META };
  }
}

export class FakeEditService implements EditService {
  async edit(request: EditRequest): Promise<ServiceResult<EditCommand>> {
    void request;
    return { data: { op: "toggle", targetId: "wearable-fake-1" }, meta: FAKE_META };
  }
}

export class FakeFitCheckService implements FitCheckService {
  async check(request: FitCheckRequest): Promise<CritiqueReport> {
    void request;
    return {
      lookId: "look-fake-1",
      score: 90,
      summary: "Fake fit check passed.",
      issues: [],
      suggestions: [],
    };
  }
}

export class FakeWearableService implements WearableService {
  private readonly jobs = new Map<string, JobStatus[]>();
  private nextId = 1;

  async createJob(spec: WearableSpec): Promise<string> {
    void spec;
    const jobId = `job-fake-${this.nextId}`;
    this.nextId += 1;
    this.jobs.set(jobId, [
      { jobId, state: "queued" },
      { jobId, state: "running", progress: { completed: 1, total: 2 } },
      { jobId, state: "succeeded", progress: { completed: 2, total: 2 } },
    ]);
    return jobId;
  }

  getJob(jobId: string): JobStatus | null {
    const states = this.jobs.get(jobId);
    if (states === undefined) {
      return null;
    }
    return states[states.length - 1];
  }

  async subscribe(
    jobId: string,
    emit: (status: JobStatus) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const states = this.jobs.get(jobId) ?? [];
    for (const status of states) {
      if (signal.aborted) {
        return;
      }
      await emit(status);
    }
  }
}
