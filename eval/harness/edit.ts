import type { BudgetTracker, EditBatch, LookSpec } from "../../packages/shared/src/index.ts";
import { MuseEditService } from "../../apps/server/src/lib/muse-services.ts";
import { defaultRetryPolicy } from "../../apps/server/src/lib/model-client.ts";
import { InMemoryRateLimiter } from "../../apps/server/src/lib/rate-limit.ts";
import { EditUnresolvedError } from "../../apps/server/src/lib/services.ts";
import { asksToChangeSkinTone } from "../../apps/server/src/lib/skin-tone-guard.ts";
import { EDIT_LOOKS } from "./edit-looks.ts";
import { parseEditCase, scoreCase, summarizeEdits } from "./edit-scoring.ts";
import type { EditOutcome, ScoreFields, SummaryRow } from "./edit-scoring.ts";

// Null means the model answered but nothing in the look matched, which the app reports as unresolved.
export type EditFn = (utterance: string, look: LookSpec, budget: BudgetTracker, signal: AbortSignal) => Promise<EditBatch | null>;

export function createEditCase(editFn: EditFn) {
  return async (raw: unknown, ctx: { signal: AbortSignal }): Promise<ScoreFields> => {
    const input = parseEditCase(raw);
    if (asksToChangeSkinTone(input.utterance)) {
      return { ...scoreCase(input, { kind: "refused" }), costUsd: 0 };
    }
    let spentUsd = 0;
    const budget: BudgetTracker = {
      record: (costUsd) => (spentUsd += costUsd),
      remaining: () => Number.POSITIVE_INFINITY,
      isExceeded: () => false,
    };
    const batch = await editFn(input.utterance, EDIT_LOOKS[input.look], budget, ctx.signal);
    const outcome: EditOutcome = batch === null ? { kind: "unresolved" } : { kind: "edits", batch };
    return { ...scoreCase(input, outcome), costUsd: spentUsd };
  };
}

let nextId = 0;
const service = new MuseEditService({
  retryPolicy: defaultRetryPolicy,
  rateLimiter: new InMemoryRateLimiter(() => ({ max: 3_000, windowMs: 60_000 })),
  newId: () => String((nextId += 1)),
});

const museEdit: EditFn = async (utterance, look, budget, signal) => {
  try {
    return (await service.edit({ utterance, look, budget }, signal)).data;
  } catch (error) {
    if (error instanceof EditUnresolvedError) {
      return null;
    }
    throw error;
  }
};

export const name = "edit";
export const runCase = createEditCase(museEdit);
export const summarize = (rows: SummaryRow[]): string => summarizeEdits(rows);
