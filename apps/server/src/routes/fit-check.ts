import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { CritiqueReport } from "@look-studio/shared";
import { invalidRequest, readJsonBody, serviceError } from "../lib/http.ts";
import type { FitCheckService } from "../lib/services.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";
import type { ClientBudgets } from "../lib/spend-cap.ts";

const FitCheckRequestBody = z.object({
  stills: z.array(z.string().min(1)).min(1).max(4),
  wearableId: z.string().min(1),
});

async function handleFitCheck(c: Context, service: FitCheckService): Promise<Response> {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return body.error === "body_too_large"
      ? c.json({ ok: false, error: "body_too_large" }, 413)
      : c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parsed = FitCheckRequestBody.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }
  try {
    const checked = CritiqueReport.safeParse(
      await service.check({ stills: parsed.data.stills, wearableId: parsed.data.wearableId }),
    );
    if (!checked.success) {
      return serviceError(c);
    }
    return c.json({ ok: true, report: checked.data });
  } catch {
    return serviceError(c);
  }
}

export function createFitCheckRoutes(service: FitCheckService, budgets: ClientBudgets): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budgets));
  app.post("/api/fit-check", (c) => handleFitCheck(c, service));
  return app;
}
