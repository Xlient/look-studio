import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AVATAR_DESCRIPTION_MAX, AvatarImage } from "@look-studio/shared";
import type { RateLimiter } from "@look-studio/shared";
import type { AvatarCheckService } from "../lib/avatar-check.ts";
import { AvatarBlockedError } from "../lib/avatar-studio.ts";
import type { AvatarClient, AvatarService } from "../lib/avatar-studio.ts";
import { invalidRequest, modelErrorResponse, readJsonBody, serviceError } from "../lib/http.ts";
import { MeshyError } from "../lib/meshy-client.ts";
import { ContentBlockedError } from "../lib/muse-image.ts";
import { clientIp } from "../lib/rate-limit.ts";
import { createSpendCapMiddleware } from "../lib/spend-cap.ts";
import type { ClientBudgets } from "../lib/spend-cap.ts";

const ConceptsBody = z.object({
  description: z.string().trim().min(1).max(AVATAR_DESCRIPTION_MAX),
  photo: AvatarImage.optional(),
});

const CheckBody = z.object({ front: AvatarImage, side: AvatarImage });

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

function avatarClient(c: Context, budgets: ClientBudgets): AvatarClient {
  const key = clientIp(c);
  return { key, budget: budgets.forClient(key) };
}

async function handleConcepts(c: Context, service: AvatarService, budgets: ClientBudgets): Promise<Response> {
  const body = await parseBody(c, ConceptsBody);
  if (body instanceof Response) {
    return body;
  }
  try {
    const concepts = await service.createConcepts(body.description, body.photo, avatarClient(c, budgets), c.req.raw.signal);
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

function handleCheck(service: AvatarCheckService, budgets: ClientBudgets, limiter: RateLimiter) {
  return async (c: Context): Promise<Response> => {
    const client = avatarClient(c, budgets);
    // Only the global cap applies: one build can use up the per-IP budget, and its check still has to run.
    if (budgets.refusalFor(client.key) === "spend_cap_exceeded") {
      return c.json({ ok: false, error: "spend_cap_exceeded" }, 429);
    }
    const body = await parseBody(c, CheckBody);
    if (body instanceof Response) {
      return body;
    }
    const decision = limiter.tryAcquire(client.key, 1);
    if (!decision.allowed) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    try {
      return c.json({ ok: true, check: await service.check(body, client.budget, c.req.raw.signal) });
    } catch (error) {
      return modelErrorResponse(c, error);
    }
  };
}

function handleStart(service: AvatarService, budgets: ClientBudgets, dailyLimiter: RateLimiter) {
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
    const jobId = service.startJob(body.conceptId, avatarClient(c, budgets));
    return jobId === null ? c.json({ ok: false, error: "concept_not_found" }, 404) : c.json({ ok: true, jobId });
  };
}

function handleStatus(c: Context, service: AvatarService): Response {
  const status = service.getJob(c.req.param("id") ?? "", clientIp(c));
  return status === null ? c.json({ ok: false, error: "job_not_found" }, 404) : c.json({ ok: true, status });
}

async function handleEvents(c: Context, service: AvatarService): Promise<Response> {
  const jobId = c.req.param("id");
  if (jobId === undefined || service.getJob(jobId, clientIp(c)) === null) {
    return c.json({ ok: false, error: "job_not_found" }, 404);
  }
  return streamSSE(c, async (stream) => {
    await service.subscribe(jobId, (status) => stream.writeSSE({ data: JSON.stringify(status) }), c.req.raw.signal);
  });
}

async function handleModel(c: Context, service: AvatarService): Promise<Response> {
  const jobId = c.req.param("id") ?? "";
  try {
    const model = await service.fetchModel(jobId, clientIp(c), c.req.raw.signal);
    return model ?? c.json({ ok: false, error: "model_not_ready" }, 404);
  } catch (error) {
    return error instanceof MeshyError ? c.json({ ok: false, error: "model_unavailable" }, 502) : serviceError(c);
  }
}

export interface AvatarCheckRoute {
  service: AvatarCheckService;
  limiter: RateLimiter;
}

export function createAvatarRoutes(service: AvatarService, budgets: ClientBudgets, dailyLimiter: RateLimiter, check: AvatarCheckRoute): Hono {
  const app = new Hono();
  // Reads stay open past the cap: the build that crossed it is already paid for and must download.
  const spendCap = createSpendCapMiddleware(budgets);
  app.post("/api/avatar/concepts", spendCap, (c) => handleConcepts(c, service, budgets));
  app.post("/api/avatar/check", handleCheck(check.service, budgets, check.limiter));
  app.post("/api/avatar", spendCap, handleStart(service, budgets, dailyLimiter));
  app.get("/api/avatar/:id", (c) => handleStatus(c, service));
  app.get("/api/avatar/:id/events", (c) => handleEvents(c, service));
  app.get("/api/avatar/:id/model", (c) => handleModel(c, service));
  return app;
}
