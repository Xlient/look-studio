import type { WearableSpec } from "@look-studio/shared";

export type JobPhase = "generating" | "fitting" | "passed" | "failed";

export interface WearableJob {
  wearableId: string;
  label: string;
  phase: JobPhase;
  progress: number;
  error?: string;
}

export interface JobStatus {
  state: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  error: string | null;
}

const STATES = new Set(["queued", "running", "succeeded", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function progressOf(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const { completed, total } = value;
  if (typeof completed !== "number" || typeof total !== "number" || !(total > 0)) {
    return null;
  }
  return Math.min(1, Math.max(0, completed / total));
}

export function parseJobStatus(value: unknown): JobStatus | null {
  if (!isRecord(value) || typeof value["state"] !== "string" || !STATES.has(value["state"])) {
    return null;
  }
  return {
    state: value["state"] as JobStatus["state"],
    progress: progressOf(value["progress"]),
    error: typeof value["error"] === "string" ? value["error"].slice(0, 200) : null,
  };
}

export function startJob(wearable: WearableSpec): WearableJob {
  return { wearableId: wearable.id, label: wearable.label, phase: "generating", progress: 0 };
}

export function isSettled(job: WearableJob): boolean {
  return job.phase === "passed" || job.phase === "failed";
}

export function applyJobStatus(job: WearableJob, status: JobStatus): WearableJob {
  if (job.phase !== "generating") {
    return job;
  }
  switch (status.state) {
    case "queued":
    case "running":
      return { ...job, progress: status.progress ?? job.progress };
    case "succeeded":
      return { ...job, phase: "fitting", progress: 1 };
    case "failed":
      return { ...job, phase: "failed", error: status.error ?? "Generation failed." };
  }
}

export function finishFit(job: WearableJob, passed: boolean): WearableJob {
  if (job.phase !== "fitting") {
    return job;
  }
  return passed ? { ...job, phase: "passed" } : { ...job, phase: "failed", error: "Didn't pass the fit check." };
}

export function failJob(job: WearableJob, error: string): WearableJob {
  return isSettled(job) ? job : { ...job, phase: "failed", error };
}

export function jobsToStart(wearables: WearableSpec[], jobs: Record<string, WearableJob>): WearableSpec[] {
  return wearables.filter((wearable) => wearable.visible !== false && jobs[wearable.id] === undefined);
}

export function jobPhaseLabel(job: WearableJob): string {
  switch (job.phase) {
    case "generating":
      return `generating ${Math.round(job.progress * 100)}%`;
    case "fitting":
      return "fitting";
    case "passed":
      return "passed";
    case "failed":
      return "failed";
  }
}
