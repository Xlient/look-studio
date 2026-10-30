import { randomUUID } from "node:crypto";
import type { BudgetTracker, RateLimiter, RetryPolicy } from "@look-studio/shared";
import { FakeAvatarCheckService, MuseAvatarCheckService } from "./lib/avatar-check.ts";
import type { AvatarCheckService } from "./lib/avatar-check.ts";
import { AvatarStudio } from "./lib/avatar-studio.ts";
import type { AvatarService } from "./lib/avatar-studio.ts";
import { FakeAvatarProvider, FakeConceptService } from "./lib/avatar-fakes.ts";
import { InlineJobQueue } from "./lib/inline-job-queue.ts";
import { createMeshyClient } from "./lib/meshy-client.ts";
import { MeshyAvatarProvider, abortableSleep } from "./lib/meshy-avatar.ts";
import { createModelClient, defaultRetryPolicy } from "./lib/model-client.ts";
import { AllowAllModeration, MuseModeration } from "./lib/moderation.ts";
import { MUSE_IMAGE_PRICE_USD, MuseImageConceptService } from "./lib/muse-image.ts";
import { envNumber } from "./env.ts";
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
import { ClientBudgets, clientDailySpendCapUsd, defaultBudgetTracker, estimateCostUsd } from "./lib/spend-cap.ts";

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
  readonly avatarService: AvatarService;
  readonly avatarLimiter: RateLimiter;
  readonly avatarCheckService: AvatarCheckService;
  readonly avatarCheckLimiter: RateLimiter;
}

// Rough USD per rigged avatar on the Meshy Pro plan; set MESHY_COST_USD to your real rate.
export function meshyCostUsd(): number {
  return envNumber("MESHY_COST_USD", 0.7);
}

const defaultAvatarLimiter: RateLimiter = new InMemoryRateLimiter(() => ({
  max: envNumber("AVATAR_DAILY_LIMIT", 3),
  windowMs: 24 * 60 * 60_000,
}));

const defaultAvatarCheckLimiter: RateLimiter = new InMemoryRateLimiter(() => ({
  max: envNumber("AVATAR_CHECK_DAILY_LIMIT", 12),
  windowMs: 24 * 60 * 60_000,
}));

// Muse Image allows 150 requests per minute.
const imageRateLimiter: RateLimiter = new InMemoryRateLimiter(() => ({ max: 150, windowMs: 60_000 }));

function fakeAvatarStudio(): AvatarService {
  return new AvatarStudio({
    moderation: new AllowAllModeration(),
    concepts: new FakeConceptService(),
    provider: new FakeAvatarProvider(),
    queue: new InlineJobQueue(),
    now: Date.now,
    newId: () => randomUUID(),
    onAvatarBuilt: () => {},
  });
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
    avatarService: overrides.avatarService ?? fakeAvatarStudio(),
    avatarLimiter: overrides.avatarLimiter ?? defaultAvatarLimiter,
    avatarCheckService: overrides.avatarCheckService ?? new FakeAvatarCheckService(),
    avatarCheckLimiter: overrides.avatarCheckLimiter ?? defaultAvatarCheckLimiter,
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
    avatarService: overrides.avatarService ?? liveAvatarStudio(base),
    avatarCheckService:
      overrides.avatarCheckService ??
      new MuseAvatarCheckService({
        retryPolicy: base.retryPolicy,
        rateLimiter: base.modelRateLimiter,
        onTokens: (total, budget) => budget.record(estimateCostUsd(total)),
      }),
  };
}

function liveAvatarStudio(base: Container): AvatarService {
  const meshyKey = process.env.MESHY_API_KEY;
  if (!meshyKey) {
    return base.avatarService;
  }
  return new AvatarStudio({
    moderation: new MuseModeration({
      retryPolicy: base.retryPolicy,
      rateLimiter: base.modelRateLimiter,
      onTokens: (total, budget) => budget.record(estimateCostUsd(total)),
    }),
    concepts: new MuseImageConceptService({
      client: createModelClient(),
      retryPolicy: base.retryPolicy,
      rateLimiter: imageRateLimiter,
      onImages: (count, budget) => budget.record(count * MUSE_IMAGE_PRICE_USD),
    }),
    provider: new MeshyAvatarProvider({
      client: createMeshyClient(meshyKey),
      retryPolicy: base.retryPolicy,
      sleep: abortableSleep,
      now: Date.now,
    }),
    queue: new InlineJobQueue(),
    now: Date.now,
    newId: () => randomUUID(),
    onAvatarBuilt: (budget) => budget.record(meshyCostUsd()),
  });
}

export function createRuntimeContainer(): Container {
  return process.env.MODEL_API_KEY ? createLiveContainer() : container;
}
