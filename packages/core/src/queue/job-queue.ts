import { JobCancelledError, JobTimeoutError, QueueClosedError, QueueFullError } from "./job-errors.ts";
import { PriorityHeap } from "./priority-heap.ts";

export interface JobProgress {
  readonly jobId: string;
  readonly completed: number;
  readonly total: number;
}

export interface JobOptions {
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JobProgress) => void;
}

export interface QueuedJob<T> {
  readonly id: string;
  readonly result: Promise<T>;
}

export type JobRun<T> = (signal: AbortSignal, report: (completed: number, total: number) => void) => Promise<T>;

export interface JobQueueConfig {
  readonly concurrency: number;
  readonly maxQueued: number;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry {
  readonly id: string;
  readonly priority: number;
  readonly seq: number;
  readonly start: () => void;
  readonly fail: (error: Error) => void;
  readonly controller: AbortController;
  done: boolean;
}

export class PriorityJobQueue {
  private readonly config: JobQueueConfig;
  private readonly timers: Timers;
  private readonly waiting = new PriorityHeap<Entry>((a, b) => a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq));
  private readonly entries = new Map<string, Entry>();
  private readonly running = new Set<string>();
  private queued = 0;
  private seq = 0;
  private closed = false;
  private idle: (() => void) | null = null;

  constructor(config: JobQueueConfig, timers: Timers = realTimers) {
    if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || !Number.isInteger(config.maxQueued) || config.maxQueued < 0) {
      throw new RangeError("concurrency must be a positive integer and maxQueued a non-negative integer");
    }
    this.config = config;
    this.timers = timers;
  }

  get stats(): { queued: number; running: number } {
    return { queued: this.queued, running: this.running.size };
  }

  enqueue<T>(run: JobRun<T>, options: JobOptions = {}): QueuedJob<T> {
    this.seq += 1;
    const id = `job-${this.seq}`;
    if (this.closed || this.queued >= this.config.maxQueued || options.signal?.aborted === true) {
      const error = this.closed ? new QueueClosedError() : options.signal?.aborted === true ? new JobCancelledError() : new QueueFullError();
      return { id, result: Promise.reject(error) };
    }
    const controller = new AbortController();
    let settle: { resolve: (value: T) => void; reject: (error: unknown) => void } | null = null;
    const result = new Promise<T>((resolve, reject) => {
      settle = { resolve, reject };
    });
    const onAbort = () => this.cancel(id);
    const finish = (entry: Entry) => {
      entry.done = true;
      this.entries.delete(id);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const entry: Entry = {
      id,
      priority: options.priority ?? 0,
      seq: this.seq,
      controller,
      done: false,
      fail: (error) => {
        finish(entry);
        settle?.reject(error);
      },
      start: () => {
        this.running.add(id);
        const timeoutMs = options.timeoutMs;
        const timer =
          timeoutMs === undefined ? null : this.timers.set(() => controller.abort(new JobTimeoutError(timeoutMs)), timeoutMs);
        const report = (completed: number, total: number) => {
          if (!entry.done) {
            options.onProgress?.({ jobId: id, completed, total });
          }
        };
        // Starts in the same tick when a slot is free, so callers see progress reported straight away.
        let pending: Promise<T>;
        try {
          pending = Promise.resolve(run(controller.signal, report));
        } catch (error) {
          pending = Promise.reject(error);
        }
        pending
          .then(
            (value) => settle?.resolve(value),
            (error: unknown) => settle?.reject(controller.signal.aborted ? (controller.signal.reason ?? error) : error),
          )
          .finally(() => {
            if (timer !== null) {
              this.timers.clear(timer);
            }
            finish(entry);
            this.running.delete(id);
            this.pump();
          });
      },
    };
    this.entries.set(id, entry);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    this.waiting.push(entry);
    this.queued += 1;
    this.pump();
    return { id, result };
  }

  cancel(jobId: string): boolean {
    const entry = this.entries.get(jobId);
    if (entry === undefined || entry.done) {
      return false;
    }
    if (this.running.has(jobId)) {
      entry.controller.abort(new JobCancelledError());
    } else {
      this.queued -= 1;
      entry.fail(new JobCancelledError());
    }
    return true;
  }

  // Stops new work, fails waiting jobs, gives running jobs graceMs to finish, then aborts them.
  async shutdown(graceMs: number): Promise<void> {
    this.closed = true;
    for (const entry of this.waiting.drain()) {
      if (!entry.done) {
        this.queued -= 1;
        entry.fail(new QueueClosedError());
      }
    }
    if (this.running.size === 0) {
      return;
    }
    const drained = new Promise<void>((resolve) => {
      this.idle = resolve;
    });
    const timer = this.timers.set(() => {
      for (const id of this.running) {
        this.entries.get(id)?.controller.abort(new QueueClosedError());
      }
    }, graceMs);
    await drained;
    this.timers.clear(timer);
  }

  private pump(): void {
    while (!this.closed && this.running.size < this.config.concurrency) {
      const next = this.waiting.pop();
      if (next === undefined) {
        break;
      }
      if (!next.done) {
        this.queued -= 1;
        next.start();
      }
    }
    if (this.running.size === 0 && this.idle !== null) {
      this.idle();
      this.idle = null;
    }
  }
}
