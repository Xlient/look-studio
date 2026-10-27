import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("health routes", () => {
  it("GET /health returns ok", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("look-studio-server");
  });

  it("GET /api/health returns ok", async () => {
    const res = await createApp().request("/api/health");
    expect(res.status).toBe(200);
  });

  it("unknown routes return 404", async () => {
    const res = await createApp().request("/nope");
    expect(res.status).toBe(404);
  });
});
