export class QueueFullError extends Error {
  constructor() {
    super("queue_full");
    this.name = "QueueFullError";
  }
}

export class QueueClosedError extends Error {
  constructor() {
    super("queue_closed");
    this.name = "QueueClosedError";
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super("job_cancelled");
    this.name = "JobCancelledError";
  }
}

export class JobTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("job_timeout");
    this.name = "JobTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
