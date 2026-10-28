import { jobPhaseLabel } from "../studio/wearable-jobs.ts";
import type { WearableJob } from "../studio/wearable-jobs.ts";

export default function JobList({ jobs }: { jobs: WearableJob[] }) {
  if (jobs.length === 0) {
    return null;
  }
  return (
    <ul className="jobs" aria-label="Wearable jobs" aria-live="polite">
      {jobs.map((job) => (
        <li key={job.wearableId} className={`job job--${job.phase}`}>
          <span className="job__label">{job.label}</span>
          <span className="job__phase">{jobPhaseLabel(job)}</span>
          {job.error !== undefined && <span className="job__error">{job.error}</span>}
        </li>
      ))}
    </ul>
  );
}
