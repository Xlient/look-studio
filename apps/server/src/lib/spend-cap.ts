import type { Context, Next } from "hono";
import { LruCache, SlidingWindowBudget } from "@look-studio/core";
import type { BudgetTracker } from "@look-studio/shared";
import { envNumber } from "../env.ts";
import { clientIp } from "./rate-limit.ts";

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

export { SlidingWindowBudget as InMemoryBudgetTracker };

export type BudgetRefusal = "spend_cap_exceeded" | "client_budget_exceeded";

// Beyond this many recent clients the least recent is forgotten, which resets only its own budget.
const MAX_TRACKED_CLIENTS = 10_000;

export class ClientBudgets {
  private readonly capUsd: () => number;
  private readonly global: BudgetTracker;
  private readonly now: () => number;
  private readonly clients = new LruCache<string, SlidingWindowBudget>(MAX_TRACKED_CLIENTS);

  constructor(capUsd: () => number, global: BudgetTracker, now: () => number = Date.now) {
    this.capUsd = capUsd;
    this.global = global;
    this.now = now;
  }

  refusalFor(client: string): BudgetRefusal | null {
    if (this.global.isExceeded()) {
      return "spend_cap_exceeded";
    }
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

  private tracker(client: string): SlidingWindowBudget {
    const existing = this.clients.get(client);
    if (existing !== undefined) {
      return existing;
    }
    const created = new SlidingWindowBudget(this.capUsd, this.now);
    this.clients.set(client, created);
    return created;
  }
}

const ledger = new SlidingWindowBudget(() => dailySpendCapUsd());

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

