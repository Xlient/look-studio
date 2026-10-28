import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { EditCommand, LookSpec } from "@look-studio/shared";
import type { BudgetTracker } from "@look-studio/shared";
import { invalidRequest, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import type { EditService } from "../lib/services.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";

const EditRequestBody = z.object({
  utterance: z.string().min(1).max(2000),
  look: LookSpec,
});

async function handleEdit(c: Context, service: EditService): Promise<Response> {
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
  try {
    const result = await service.edit(
      { utterance: parsed.data.utterance, look: parsed.data.look },
      c.req.raw.signal,
    );
    const checked = EditCommand.safeParse(result.data);
    if (!checked.success) {
      return serviceError(c);
    }
    return c.json({ ok: true, command: checked.data, meta: result.meta });
  } catch (error) {
    return modelErrorResponse(c, error);
  }
}

export function createEditRoutes(service: EditService, budget: BudgetTracker): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budget));
  app.post("/api/edit", (c) => handleEdit(c, service));
  return app;
}
