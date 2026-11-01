import { ExponentialBackoffRetryPolicy as CoreRetryPolicy } from "@look-studio/core";
import type { RetryExtras, RetryPolicyConfig } from "@look-studio/core";
import type { RetryPolicy } from "@look-studio/shared";

export { BACKOFF_BASE_MS, computeBackoffMs } from "@look-studio/core";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExponentialBackoffRetryPolicy extends CoreRetryPolicy implements RetryPolicy {
  constructor(
    config: () => RetryPolicyConfig,
    wait: (ms: number) => Promise<void> = sleep,
    random: () => number = Math.random,
    extras: RetryExtras = {},
  ) {
    super(config, wait, random, extras);
  }
}
