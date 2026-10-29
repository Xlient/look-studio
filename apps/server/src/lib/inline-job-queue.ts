import type { EnqueueOptions, Job, JobQueue } from "@look-studio/shared";

// Stand-in until the core job queue lands: runs each job at once, with cancel and timeout.
export class InlineJobQueue implements JobQueue {
  private readonly running = new Map<string, AbortController>();
  private nextId = 1;

  enqueue<T>(run: (signal: AbortSignal) => Promise<T>, options: EnqueueOptions = {}): Job<T> {
    const id = `job-${this.nextId}`;
    this.nextId += 1;
    const controller = new AbortController();
    this.running.set(id, controller);
    const signals = [controller.signal];
    if (options.signal !== undefined) {
      signals.push(options.signal);
    }
    if (options.timeoutMs !== undefined) {
      signals.push(AbortSignal.timeout(options.timeoutMs));
    }
    const result = run(AbortSignal.any(signals)).finally(() => this.running.delete(id));
    return { id, result };
  }

  cancel(jobId: string): boolean {
    const controller = this.running.get(jobId);
    controller?.abort();
    return controller !== undefined;
  }
}
