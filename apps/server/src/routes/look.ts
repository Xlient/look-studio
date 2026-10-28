import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { LookSpec } from "@look-studio/shared";
import type { BudgetTracker } from "@look-studio/shared";
import { invalidRequest, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import type { LookService } from "../lib/services.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";

const LookRequestBody = z.object({
  chat: z.string().min(1).max(2000),
  image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
});

async function handleLook(c: Context, service: LookService): Promise<Response> {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return body.error === "body_too_large"
      ? c.json({ ok: false, error: "body_too_large" }, 413)
      : c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parsed = LookRequestBody.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }
  try {
    const result = await service.createLook(
      { chat: parsed.data.chat, image: parsed.data.image },
      c.req.raw.signal,
    );
    const checked = LookSpec.safeParse(result.data);
    if (!checked.success) {
      return serviceError(c);
    }
    return c.json({ ok: true, look: checked.data, meta: result.meta });
  } catch (error) {
    return modelErrorResponse(c, error);
  }
}

export function createLookRoutes(service: LookService, budget: BudgetTracker): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budget));
  app.post("/api/look", (c) => handleLook(c, service));
  return app;
}
