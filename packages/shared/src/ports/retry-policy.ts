// Shared has no DOM lib; this names AbortSignal without adding a dependency.
/// <reference lib="dom" />

export interface RetryOptions {
  readonly signal?: AbortSignal;
  readonly shouldRetry?: (error: unknown) => boolean;
}

export interface RetryPolicy {
  run<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
}
