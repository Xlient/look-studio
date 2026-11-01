export const DAY_MS = 24 * 60 * 60_000;

export interface SpendWindowConfig {
  readonly windowMs: number;
  readonly bucketMs: number;
}

// Five-minute buckets keep memory fixed; spend leaves the window in five-minute steps.
export const DAILY_WINDOW: SpendWindowConfig = { windowMs: DAY_MS, bucketMs: 5 * 60_000 };

export class SlidingWindowBudget {
  private readonly capUsd: () => number;
  private readonly now: () => number;
  private readonly window: SpendWindowConfig;
  private readonly buckets = new Map<number, number>();

  constructor(capUsd: () => number, now: () => number = Date.now, window: SpendWindowConfig = DAILY_WINDOW) {
    if (!(window.bucketMs > 0) || !(window.windowMs >= window.bucketMs)) {
      throw new RangeError("the window must hold at least one positive-length bucket");
    }
    this.capUsd = capUsd;
    this.now = now;
    this.window = window;
  }

  record(costUsd: number): number {
    const bucket = Math.floor(this.now() / this.window.bucketMs);
    if (Number.isFinite(costUsd) && costUsd > 0) {
      this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + costUsd);
    }
    return this.spent();
  }

  spent(): number {
    const oldest = Math.floor((this.now() - this.window.windowMs) / this.window.bucketMs);
    let total = 0;
    for (const [bucket, costUsd] of this.buckets) {
      if (bucket <= oldest) {
        this.buckets.delete(bucket);
      } else {
        total += costUsd;
      }
    }
    return total;
  }

  remaining(): number {
    return Math.max(0, this.capUsd() - this.spent());
  }

  isExceeded(): boolean {
    return this.spent() >= this.capUsd();
  }

  reset(): void {
    this.buckets.clear();
  }
}
