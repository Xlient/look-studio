import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { defaultRetryPolicy } from "./lib/model-client.ts";
import { defaultRateLimiter } from "./lib/rate-limit.ts";
import { defaultBudgetTracker } from "./lib/spend-cap.ts";

export interface Container {
  readonly rateLimiter: RateLimiter;
  readonly budgetTracker: BudgetTracker;
  readonly retryPolicy: RetryPolicy;
}

export function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    rateLimiter: overrides.rateLimiter ?? defaultRateLimiter,
    budgetTracker: overrides.budgetTracker ?? defaultBudgetTracker,
    retryPolicy: overrides.retryPolicy ?? defaultRetryPolicy,
  };
}

export const container: Container = createContainer();
