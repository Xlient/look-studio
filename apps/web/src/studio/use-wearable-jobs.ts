import { useEffect, useRef, useState } from "react";
import type { LookSpec, WearableSpec } from "@look-studio/shared";
import { createWearableJob, errorMessage, watchWearableJob } from "./api-client.ts";
import { applyJobStatus, failJob, finishFit, jobsToStart, startJob } from "./wearable-jobs.ts";
import type { WearableJob } from "./wearable-jobs.ts";

export type FitCheck = (wearable: WearableSpec, signal: AbortSignal) => Promise<boolean>;

// Replaced by the real fit check once wearable providers land.
const passFitCheck: FitCheck = () => Promise.resolve(true);

export function useWearableJobs(look: LookSpec | null, fitCheck: FitCheck = passFitCheck): WearableJob[] {
  const [jobs, setJobs] = useState<Record<string, WearableJob>>({});
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const wearables = look?.wearables ?? [];
    const keep = new Set(wearables.filter((wearable) => wearable.visible !== false).map((wearable) => wearable.id));
    for (const [id, controller] of controllers.current) {
      if (!keep.has(id)) {
        controller.abort();
        controllers.current.delete(id);
      }
    }
    const starting = jobsToStart(wearables, jobsRef.current);
    setJobs((current) => {
      const next: Record<string, WearableJob> = {};
      for (const id of keep) {
        const job = current[id];
        if (job !== undefined) {
          next[id] = job;
        }
      }
      for (const wearable of starting) {
        next[wearable.id] = startJob(wearable);
      }
      return next;
    });
    for (const wearable of starting) {
      const controller = new AbortController();
      controllers.current.set(wearable.id, controller);
      void runJob(wearable, controller.signal, fitCheck, (update) =>
        setJobs((current) => {
          const job = current[wearable.id];
          return job === undefined || controller.signal.aborted ? current : { ...current, [wearable.id]: update(job) };
        }),
      );
    }
  }, [look, fitCheck]);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) {
        controller.abort();
      }
      active.clear();
    };
  }, []);

  return Object.values(jobs);
}

async function runJob(
  wearable: WearableSpec,
  signal: AbortSignal,
  fitCheck: FitCheck,
  update: (change: (job: WearableJob) => WearableJob) => void,
): Promise<void> {
  const created = await createWearableJob(wearable, { signal });
  if (!created.ok) {
    update((job) => failJob(job, errorMessage(created.error, created.retryAfterS)));
    return;
  }
  const watched = await watchWearableJob(created.jobId, {
    signal,
    onStatus: (status) => update((job) => applyJobStatus(job, status)),
  });
  if (!watched.ok) {
    update((job) => failJob(job, errorMessage(watched.error, watched.retryAfterS)));
    return;
  }
  const passed = await fitCheck(wearable, signal).catch(() => false);
  update((job) => (job.phase === "fitting" ? finishFit(job, passed) : failJob(job, "The job ended without a result.")));
}
