import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { defaultRetryPolicy } from "./lib/model-client.ts";
import { defaultRateLimiter } from "./lib/rate-limit.ts";
import {
  FakeEditService,
  FakeFitCheckService,
  FakeLookService,
  FakeWearableService,
} from "./lib/services.ts";
import type {
  EditService,
  FitCheckService,
  LookService,
  WearableService,
} from "./lib/services.ts";
import { defaultBudgetTracker } from "./lib/spend-cap.ts";

export interface Container {
  readonly rateLimiter: RateLimiter;
  readonly budgetTracker: BudgetTracker;
  readonly retryPolicy: RetryPolicy;
  readonly lookService: LookService;
  readonly editService: EditService;
  readonly fitCheckService: FitCheckService;
  readonly wearableService: WearableService;
}

export function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    rateLimiter: overrides.rateLimiter ?? defaultRateLimiter,
    budgetTracker: overrides.budgetTracker ?? defaultBudgetTracker,
    retryPolicy: overrides.retryPolicy ?? defaultRetryPolicy,
    lookService: overrides.lookService ?? new FakeLookService(),
    editService: overrides.editService ?? new FakeEditService(),
    fitCheckService: overrides.fitCheckService ?? new FakeFitCheckService(),
    wearableService: overrides.wearableService ?? new FakeWearableService(),
  };
}

export const container: Container = createContainer();
