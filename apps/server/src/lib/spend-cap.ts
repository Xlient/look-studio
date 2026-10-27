import type { Context, Next } from "hono";
import type { BudgetTracker } from "@look-studio/shared";
import { envNumber } from "../env.ts";

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySpendCapUsd(): number {
  return envNumber("DAILY_SPEND_CAP_USD", 5);
}

export function pricePer1kTokensUsd(): number {
  return envNumber("MODEL_PRICE_PER_1K_TOKENS_USD", 0.002);
}

export function estimateCostUsd(totalTokens: number): number {
  return (totalTokens / 1000) * pricePer1kTokensUsd();
}

export class InMemoryBudgetTracker implements BudgetTracker {
  private readonly capUsd: () => number;
  private readonly today: () => string;
  private day: string;
  private spendUsd = 0;

  constructor(capUsd: () => number, today: () => string = () => utcDay()) {
    this.capUsd = capUsd;
    this.today = today;
    this.day = this.today();
  }

  record(costUsd: number): number {
    this.rollover();
    this.spendUsd += costUsd;
    return this.spendUsd;
  }

  remaining(): number {
    this.rollover();
    return this.capUsd() - this.spendUsd;
  }

  isExceeded(): boolean {
    this.rollover();
    return this.spendUsd >= this.capUsd();
  }

  spent(): number {
    this.rollover();
    return this.spendUsd;
  }

  reset(): void {
    this.day = this.today();
    this.spendUsd = 0;
  }

  private rollover(): void {
    const current = this.today();
    if (this.day !== current) {
      this.day = current;
      this.spendUsd = 0;
    }
  }
}

const ledger = new InMemoryBudgetTracker(() => dailySpendCapUsd());

export const defaultBudgetTracker: BudgetTracker = ledger;

export function resetSpendLedger(): void {
  ledger.reset();
}

export function getDailySpendUsd(): number {
  return ledger.spent();
}

export function recordSpend(totalTokens: number): number {
  return ledger.record(estimateCostUsd(totalTokens));
}

export function isSpendCapExceeded(): boolean {
  return ledger.isExceeded();
}

export function createSpendCapMiddleware(
  tracker: BudgetTracker,
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    if (tracker.isExceeded()) {
      return c.json({ ok: false, error: "spend_cap_exceeded" }, 429);
    }
    return next();
  };
}

export const spendCap = createSpendCapMiddleware(defaultBudgetTracker);
