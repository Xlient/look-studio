import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { LookSpec } from "@look-studio/shared";
import { clientIp } from "../lib/rate-limit.ts";
import { invalidRequest, modelErrorBody, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import type { LookRequest, LookService } from "../lib/services.ts";
import { asksToChangeSkinTone } from "../lib/skin-tone-guard.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";
import type { ClientBudgets } from "../lib/spend-cap.ts";

const LookRequestBody = z.object({
  chat: z.string().min(1).max(2000),
  image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
});

async function parseLookRequest(c: Context, budgets: ClientBudgets): Promise<LookRequest | Response> {
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
  if (asksToChangeSkinTone(parsed.data.chat)) {
    return c.json({ ok: false, error: "skin_tone_change" }, 422);
  }
  return { chat: parsed.data.chat, image: parsed.data.image, budget: budgets.forClient(clientIp(c)) };
}

async function handleLook(c: Context, service: LookService, budgets: ClientBudgets): Promise<Response> {
  const request = await parseLookRequest(c, budgets);
  if (request instanceof Response) {
    return request;
  }
  try {
    const result = await service.createLook(request, c.req.raw.signal);
    const checked = LookSpec.safeParse(result.data);
    if (!checked.success) {
      return serviceError(c);
    }
    return c.json({ ok: true, look: checked.data, meta: result.meta });
  } catch (error) {
    return modelErrorResponse(c, error);
  }
}

async function handleLookStream(c: Context, service: LookService, budgets: ClientBudgets): Promise<Response> {
  const request = await parseLookRequest(c, budgets);
  if (request instanceof Response) {
    return request;
  }
  return streamSSE(c, async (stream) => {
    let writes = Promise.resolve();
    const onDescription = (text: string) => {
      writes = writes.then(() => stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) }));
    };
    try {
      const result = await service.createLook(request, c.req.raw.signal, onDescription);
      await writes;
      const checked = LookSpec.safeParse(result.data);
      await stream.writeSSE(
        checked.success
          ? { event: "look", data: JSON.stringify({ look: checked.data, meta: result.meta }) }
          : { event: "error", data: JSON.stringify({ error: "service_error", retryAfterS: null }) },
      );
    } catch (error) {
      await writes;
      const body = modelErrorBody(error);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: body.error, retryAfterS: body.retryAfterS }) });
    }
  });
}

export function createLookRoutes(service: LookService, budgets: ClientBudgets): Hono {
  const app = new Hono();
  const spendCap = createSpendCapMiddleware(budgets);
  app.post("/api/look", spendCap, (c) => handleLook(c, service, budgets));
  app.post("/api/look/stream", spendCap, (c) => handleLookStream(c, service, budgets));
  return app;
}
