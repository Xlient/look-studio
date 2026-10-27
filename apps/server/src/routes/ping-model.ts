import { Hono } from "hono";
import type { Context } from "hono";
import { toJSONSchema, z } from "zod";
import { container } from "../container.ts";
import { callModelStructured } from "../lib/model-client.ts";
import { ModelError } from "../lib/model-errors.ts";
import { createSpendCapMiddleware, estimateCostUsd } from "../lib/spend-cap.ts";

const PingResult = z.object({ pong: z.boolean() });
const PingResultJsonSchema = toJSONSchema(PingResult) as unknown as Record<string, unknown>;

async function ping(c: Context): Promise<Response> {
  if (!process.env.MODEL_API_KEY) {
    return c.json({ ok: false, error: "model_not_configured" }, 503);
  }
  const model = process.env.MODEL_NAME;
  if (!model) {
    return c.json({ ok: false, error: "model_not_configured" }, 503);
  }
  try {
    const result = await callModelStructured<{ pong: boolean }>({
      model,
      prompt: 'Reply with exactly {"pong": true}.',
      schemaName: "ping_result",
      schema: PingResultJsonSchema,
      signal: c.req.raw.signal,
      retryPolicy: container.retryPolicy,
    });
    const spendUsd = container.budgetTracker.record(estimateCostUsd(result.tokens.total));
    if (!PingResult.safeParse(result.data).success) {
      return c.json({ ok: false, error: "model_bad_response" }, 502);
    }
    return c.json({
      ok: true,
      latencyMs: result.latencyMs,
      tokens: result.tokens,
      requestId: result.requestId,
      model: result.model,
      spendUsd,
    });
  } catch (error) {
    if (error instanceof ModelError && error.kind === "rate_limited") {
      return c.json({ ok: false, error: "model_rate_limited" }, 429);
    }
    return c.json({ ok: false, error: "model_error" }, 502);
  }
}

export const pingModelRoutes = new Hono()
  .use("/api/ping-model", createSpendCapMiddleware(container.budgetTracker))
  .get("/api/ping-model", ping)
  .post("/api/ping-model", ping);
