import { Hono } from "hono";
import type { Context } from "hono";

const startedAt = Date.now();

function health(c: Context): Response {
  return c.json({
    ok: true,
    service: "look-studio-server",
    uptimeMs: Date.now() - startedAt,
  });
}

export const healthRoutes = new Hono().get("/health", health).get("/api/health", health);
