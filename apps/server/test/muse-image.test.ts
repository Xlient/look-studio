import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { buildConceptPrompt } from "../src/lib/avatar-prompts.ts";
import { InMemoryRateLimiter } from "../src/lib/rate-limit.ts";
import { ContentBlockedError, MUSE_IMAGE_MODEL, MuseImageConceptService, toConceptImages } from "../src/lib/muse-image.ts";
import { ExponentialBackoffRetryPolicy } from "../src/lib/retry-policy.ts";

const B64 = "UklGRgAAAABXRUJQ";
const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function service(responses: Response[], max = 150) {
  const requests: { url: string; multipart: boolean; body: string }[] = [];
  const client = new OpenAI({
    apiKey: "test",
    baseURL: "https://api.meta.ai/v1",
    maxRetries: 0,
    fetch: async (input, init) => {
      if (String(input).startsWith("data:")) {
        return fetch(input, init);
      }
      const body = init?.body;
      requests.push({
        url: String(input),
        multipart: body instanceof FormData,
        body: typeof body === "string" ? body : "",
      });
      return responses.shift() ?? new Response("{}", { status: 500 });
    },
  });
  let images = 0;
  const concepts = new MuseImageConceptService({
    client,
    retryPolicy: new ExponentialBackoffRetryPolicy(() => ({ maxRetries: 1, baseMs: 0 }), async () => {}, () => 0),
    rateLimiter: new InMemoryRateLimiter(() => ({ max, windowMs: 60_000 })),
    onImages: (count) => {
      images += count;
    },
  });
  return { concepts, requests, images: () => images };
}

const ok = (count: number) =>
  new Response(JSON.stringify({ created: 1, data: Array.from({ length: count }, () => ({ b64_json: B64 })) }), {
    headers: { "content-type": "application/json" },
  });

describe("Muse Image concepts", () => {
  it("asks for three A-pose WebP concepts from text and bills each image", async () => {
    const { concepts, requests, images } = service([ok(3)]);
    const result = await concepts.createConcepts({ description: "grumpy robot barista" }, new AbortController().signal);
    expect(result).toEqual(Array.from({ length: 3 }, () => `data:image/webp;base64,${B64}`));
    expect(requests[0]?.url).toBe("https://api.meta.ai/v1/images/generations");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({ model: MUSE_IMAGE_MODEL, n: 3, output_format: "webp" });
    expect(images()).toBe(3);
  });

  it("uses the edits endpoint with the photo as a reference, never as a likeness", async () => {
    const { concepts, requests } = service([ok(3)]);
    await concepts.createConcepts({ description: "streetwear fox", photo: PHOTO }, new AbortController().signal);
    expect(requests[0]?.url).toBe("https://api.meta.ai/v1/images/edits");
    expect(requests[0]?.multipart).toBe(true);
    expect(buildConceptPrompt("x", true)).toContain("Do not copy the person's face");
  });

  it("turns a content-policy block into ContentBlockedError without retrying", async () => {
    const blocked = new Response(JSON.stringify({ error: { code: "content_policy_violation", message: "no" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const { concepts, requests } = service([blocked]);
    await expect(concepts.createConcepts({ description: "x" }, new AbortController().signal)).rejects.toBeInstanceOf(ContentBlockedError);
    expect(requests).toHaveLength(1);
  });

  it("retries a 503 once and respects the image rate limit", async () => {
    const { concepts, requests } = service([new Response("busy", { status: 503 }), ok(3)]);
    await concepts.createConcepts({ description: "x" }, new AbortController().signal);
    expect(requests).toHaveLength(2);
    const limited = service([ok(3)], 3);
    await limited.concepts.createConcepts({ description: "x" }, new AbortController().signal);
    await expect(limited.concepts.createConcepts({ description: "x" }, new AbortController().signal)).rejects.toMatchObject({ kind: "rate_limited" });
    expect(limited.requests).toHaveLength(1);
  });

  it("keeps only valid images and fails on none", () => {
    expect(toConceptImages([{ b64_json: B64 }, { b64_json: "not base64!" }, {}], "webp")).toHaveLength(1);
    expect(() => toConceptImages([], "webp")).toThrow();
  });
});
