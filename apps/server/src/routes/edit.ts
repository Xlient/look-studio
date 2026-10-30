import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { EditBatch, LookSpec } from "@look-studio/shared";
import { clientIp } from "../lib/rate-limit.ts";
import { invalidRequest, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import type { EditService } from "../lib/services.ts";
import { asksToChangeSkinTone } from "../lib/skin-tone-guard.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";
import type { ClientBudgets } from "../lib/spend-cap.ts";

const EditRequestBody = z.object({
  utterance: z.string().min(1).max(2000),
  look: LookSpec,
});

async function handleEdit(c: Context, service: EditService, budgets: ClientBudgets): Promise<Response> {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return body.error === "body_too_large"
      ? c.json({ ok: false, error: "body_too_large" }, 413)
      : c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parsed = EditRequestBody.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }
  if (asksToChangeSkinTone(parsed.data.utterance)) {
    return c.json({ ok: false, error: "skin_tone_change" }, 422);
  }
  try {
    const result = await service.edit(
      { utterance: parsed.data.utterance, look: parsed.data.look, budget: budgets.forClient(clientIp(c)) },
      c.req.raw.signal,
    );
    const checked = EditBatch.safeParse(result.data);
    if (!checked.success) {
      return serviceError(c);
    }
    return c.json({ ok: true, edits: checked.data, meta: result.meta });
  } catch (error) {
    return modelErrorResponse(c, error);
  }
}

export function createEditRoutes(service: EditService, budgets: ClientBudgets): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budgets));
  app.post("/api/edit", (c) => handleEdit(c, service, budgets));
  return app;
}
