import type { Context, Next } from "hono";
import type { BudgetTracker } from "@look-studio/shared";
import { envNumber } from "../env.ts";
import { clientIp } from "./rate-limit.ts";

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySpendCapUsd(): number {
  return envNumber("DAILY_SPEND_CAP_USD", 5);
}

export function clientDailySpendCapUsd(): number {
  return envNumber("CLIENT_DAILY_SPEND_CAP_USD", 2);
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

export type BudgetRefusal = "spend_cap_exceeded" | "client_budget_exceeded";

export class ClientBudgets {
  private readonly capUsd: () => number;
  private readonly global: BudgetTracker;
  private readonly today: () => string;
  private readonly clients = new Map<string, InMemoryBudgetTracker>();
  private day: string;

  constructor(capUsd: () => number, global: BudgetTracker, today: () => string = () => utcDay()) {
    this.capUsd = capUsd;
    this.global = global;
    this.today = today;
    this.day = this.today();
  }

  refusalFor(client: string): BudgetRefusal | null {
    if (this.global.isExceeded()) {
      return "spend_cap_exceeded";
    }
    this.rollover();
    return this.clients.get(client)?.isExceeded() === true ? "client_budget_exceeded" : null;
  }

  forClient(client: string): BudgetTracker {
    return {
      record: (costUsd) => {
        this.global.record(costUsd);
        return this.tracker(client).record(costUsd);
      },
      remaining: () => Math.min(this.global.remaining(), this.tracker(client).remaining()),
      isExceeded: () => this.refusalFor(client) !== null,
    };
  }

  private tracker(client: string): InMemoryBudgetTracker {
    this.rollover();
    const existing = this.clients.get(client);
    if (existing !== undefined) {
      return existing;
    }
    const created = new InMemoryBudgetTracker(this.capUsd, this.today);
    this.clients.set(client, created);
    return created;
  }

  private rollover(): void {
    const current = this.today();
    if (this.day !== current) {
      this.day = current;
      this.clients.clear();
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
  budgets: ClientBudgets,
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    const refusal = budgets.refusalFor(clientIp(c));
    if (refusal !== null) {
      return c.json({ ok: false, error: refusal }, 429);
    }
    return next();
  };
}

