import { Hono } from "hono";
import { container } from "./container.ts";
import { createRateLimitMiddleware } from "./lib/rate-limit.ts";
import { healthRoutes } from "./routes/health.ts";
import { pingModelRoutes } from "./routes/ping-model.ts";

export function createApp(): Hono {
  const app = new Hono();
  app.use(createRateLimitMiddleware(container.rateLimiter));
  app.route("/", healthRoutes);
  app.route("/", pingModelRoutes);
  app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));
  return app;
}
