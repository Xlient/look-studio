export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
}

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("circuit_open");
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private readonly config: () => CircuitBreakerConfig;
  private readonly now: () => number;
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(config: () => CircuitBreakerConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  state(): CircuitState {
    if (this.openedAt === null) {
      return "closed";
    }
    return this.now() - this.openedAt >= this.config().cooldownMs ? "half-open" : "open";
  }

  // Throws while open; in half-open, lets exactly one probe through until it reports back.
  admit(): void {
    const state = this.state();
    if (state === "closed") {
      return;
    }
    if (state === "half-open" && !this.probing) {
      this.probing = true;
      return;
    }
    const waited = this.now() - (this.openedAt ?? this.now());
    throw new CircuitOpenError(Math.max(1, this.config().cooldownMs - waited));
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    this.failures += 1;
    if (this.probing || this.failures >= this.config().failureThreshold) {
      this.openedAt = this.now();
    }
    this.probing = false;
  }
}
