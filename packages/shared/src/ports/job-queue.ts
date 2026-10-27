// Shared has no DOM lib; this names AbortSignal without adding a dependency.
/// <reference lib="dom" />

export interface JobProgress {
  readonly jobId: string;
  readonly completed: number;
  readonly total: number;
}

export interface EnqueueOptions {
  // Higher runs first.
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JobProgress) => void;
}

export interface Job<T> {
  readonly id: string;
  readonly result: Promise<T>;
}

export interface JobQueue {
  enqueue<T>(run: (signal: AbortSignal) => Promise<T>, options?: EnqueueOptions): Job<T>;
  cancel(jobId: string): boolean;
}
