import { Hono } from "hono";
import { container } from "./container.ts";
import type { Container } from "./container.ts";
import { createRateLimitMiddleware } from "./lib/rate-limit.ts";
import { createAvatarRoutes } from "./routes/avatar.ts";
import { createEditRoutes } from "./routes/edit.ts";
import { createFitCheckRoutes } from "./routes/fit-check.ts";
import { healthRoutes } from "./routes/health.ts";
import { createLookRoutes } from "./routes/look.ts";
import { pingModelRoutes } from "./routes/ping-model.ts";
import { createWearableRoutes } from "./routes/wearable.ts";

export function createApp(active: Container = container): Hono {
  const app = new Hono();
  app.use(createRateLimitMiddleware(active.rateLimiter));
  app.route("/", healthRoutes);
  app.route("/", pingModelRoutes);
  app.route("/", createLookRoutes(active.lookService, active.budgetTracker));
  app.route("/", createEditRoutes(active.editService, active.budgetTracker));
  app.route("/", createFitCheckRoutes(active.fitCheckService, active.budgetTracker));
  app.route("/", createWearableRoutes(active.wearableService, active.budgetTracker));
  app.route("/", createAvatarRoutes(active.avatarService, active.budgetTracker, active.avatarLimiter, { service: active.avatarCheckService, limiter: active.avatarCheckLimiter }));
  app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));
  return app;
}
