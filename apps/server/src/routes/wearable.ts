import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { WearableSpec } from "@look-studio/shared";
import type { BudgetTracker } from "@look-studio/shared";
import { invalidRequest, readJsonBody, serviceError } from "../lib/http.ts";
import type { WearableService } from "../lib/services.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";

async function handleCreate(c: Context, service: WearableService): Promise<Response> {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return body.error === "body_too_large"
      ? c.json({ ok: false, error: "body_too_large" }, 413)
      : c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parsed = WearableSpec.safeParse(body.value);
  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }
  try {
    const jobId = await service.createJob(parsed.data);
    return c.json({ ok: true, jobId });
  } catch {
    return serviceError(c);
  }
}

async function handleEvents(c: Context, service: WearableService): Promise<Response> {
  const jobId = c.req.param("id");
  if (jobId === undefined || service.getJob(jobId) === null) {
    return c.json({ ok: false, error: "job_not_found" }, 404);
  }
  return streamSSE(c, async (stream) => {
    await service.subscribe(
      jobId,
      async (status) => {
        await stream.writeSSE({ data: JSON.stringify(status) });
      },
      c.req.raw.signal,
    );
  });
}

export function createWearableRoutes(service: WearableService, budget: BudgetTracker): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budget));
  app.post("/api/wearable", (c) => handleCreate(c, service));
  app.get("/api/wearable/:id/events", (c) => handleEvents(c, service));
  return app;
}
