import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AVATAR_DESCRIPTION_MAX, AvatarImage } from "@look-studio/shared";
import type { BudgetTracker, RateLimiter } from "@look-studio/shared";
import { AvatarBlockedError } from "../lib/avatar-studio.ts";
import type { AvatarService } from "../lib/avatar-studio.ts";
import { invalidRequest, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import { MeshyError } from "../lib/meshy-client.ts";
import { ContentBlockedError } from "../lib/muse-image.ts";
import { clientIp } from "../lib/rate-limit.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";

const ConceptsBody = z.object({
  description: z.string().trim().min(1).max(AVATAR_DESCRIPTION_MAX),
  photo: AvatarImage.optional(),
});

const StartBody = z.object({ conceptId: z.string().min(1).max(100) });

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return body.error === "body_too_large"
      ? c.json({ ok: false, error: "body_too_large" }, 413)
      : c.json({ ok: false, error: "invalid_request" }, 400);
  }
  const parsed = schema.safeParse(body.value);
  return parsed.success ? parsed.data : invalidRequest(c, parsed.error);
}

async function handleConcepts(c: Context, service: AvatarService): Promise<Response> {
  const body = await parseBody(c, ConceptsBody);
  if (body instanceof Response) {
    return body;
  }
  try {
    const concepts = await service.createConcepts(body.description, body.photo, c.req.raw.signal);
    return c.json({ ok: true, concepts });
  } catch (error) {
    if (error instanceof AvatarBlockedError) {
      return c.json({ ok: false, error: "avatar_blocked", category: error.category }, 422);
    }
    if (error instanceof ContentBlockedError) {
      return c.json({ ok: false, error: "avatar_blocked", category: "other_unsafe" }, 422);
    }
    return modelErrorResponse(c, error);
  }
}

function handleStart(service: AvatarService, dailyLimiter: RateLimiter) {
  return async (c: Context): Promise<Response> => {
    const body = await parseBody(c, StartBody);
    if (body instanceof Response) {
      return body;
    }
    const decision = dailyLimiter.tryAcquire(clientIp(c), 1);
    if (!decision.allowed) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      return c.json({ ok: false, error: "avatar_daily_limit" }, 429);
    }
    const jobId = service.startJob(body.conceptId);
    return jobId === null ? c.json({ ok: false, error: "concept_not_found" }, 404) : c.json({ ok: true, jobId });
  };
}

function handleStatus(c: Context, service: AvatarService): Response {
  const status = service.getJob(c.req.param("id") ?? "");
  return status === null ? c.json({ ok: false, error: "job_not_found" }, 404) : c.json({ ok: true, status });
}

async function handleEvents(c: Context, service: AvatarService): Promise<Response> {
  const jobId = c.req.param("id");
  if (jobId === undefined || service.getJob(jobId) === null) {
    return c.json({ ok: false, error: "job_not_found" }, 404);
  }
  return streamSSE(c, async (stream) => {
    await service.subscribe(jobId, (status) => stream.writeSSE({ data: JSON.stringify(status) }), c.req.raw.signal);
  });
}

async function handleModel(c: Context, service: AvatarService): Promise<Response> {
  const jobId = c.req.param("id") ?? "";
  try {
    const model = await service.fetchModel(jobId, c.req.raw.signal);
    return model ?? c.json({ ok: false, error: "model_not_ready" }, 404);
  } catch (error) {
    return error instanceof MeshyError ? c.json({ ok: false, error: "model_unavailable" }, 502) : serviceError(c);
  }
}

export function createAvatarRoutes(service: AvatarService, budget: BudgetTracker, dailyLimiter: RateLimiter): Hono {
  const app = new Hono();
  app.use(createSpendCapMiddleware(budget));
  app.post("/api/avatar/concepts", (c) => handleConcepts(c, service));
  app.post("/api/avatar", handleStart(service, dailyLimiter));
  app.get("/api/avatar/:id", (c) => handleStatus(c, service));
  app.get("/api/avatar/:id/events", (c) => handleEvents(c, service));
  app.get("/api/avatar/:id/model", (c) => handleModel(c, service));
  return app;
}
