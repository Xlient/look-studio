import { randomUUID } from "node:crypto";
import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { defaultRetryPolicy } from "./lib/model-client.ts";
import { MuseEditService, MuseLookService } from "./lib/muse-services.ts";
import { InMemoryRateLimiter, defaultRateLimiter } from "./lib/rate-limit.ts";
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
import { ClientBudgets, clientDailySpendCapUsd, defaultBudgetTracker } from "./lib/spend-cap.ts";

export interface Container {
  readonly rateLimiter: RateLimiter;
  readonly modelRateLimiter: RateLimiter;
  readonly budgetTracker: BudgetTracker;
  readonly clientBudgets: ClientBudgets;
  readonly retryPolicy: RetryPolicy;
  readonly lookService: LookService;
  readonly editService: EditService;
  readonly fitCheckService: FitCheckService;
  readonly wearableService: WearableService;
}

// Stand-in until the core token bucket lands; Muse Spark allows 3,000 requests per minute.
const defaultModelRateLimiter: RateLimiter = new InMemoryRateLimiter(() => ({ max: 3000, windowMs: 60_000 }));

export function createContainer(overrides: Partial<Container> = {}): Container {
  const budgetTracker = overrides.budgetTracker ?? defaultBudgetTracker;
  return {
    rateLimiter: overrides.rateLimiter ?? defaultRateLimiter,
    modelRateLimiter: overrides.modelRateLimiter ?? defaultModelRateLimiter,
    budgetTracker,
    clientBudgets: overrides.clientBudgets ?? new ClientBudgets(clientDailySpendCapUsd, budgetTracker),
    retryPolicy: overrides.retryPolicy ?? defaultRetryPolicy,
    lookService: overrides.lookService ?? new FakeLookService(),
    editService: overrides.editService ?? new FakeEditService(),
    fitCheckService: overrides.fitCheckService ?? new FakeFitCheckService(),
    wearableService: overrides.wearableService ?? new FakeWearableService(),
  };
}

export const container: Container = createContainer();

export function createLiveContainer(overrides: Partial<Container> = {}): Container {
  const base = createContainer(overrides);
  const deps = {
    retryPolicy: base.retryPolicy,
    rateLimiter: base.modelRateLimiter,
    newId: () => randomUUID(),
  };
  return {
    ...base,
    lookService: overrides.lookService ?? new MuseLookService(deps),
    editService: overrides.editService ?? new MuseEditService(deps),
  };
}

export function createRuntimeContainer(): Container {
  return process.env.MODEL_API_KEY ? createLiveContainer() : container;
}
