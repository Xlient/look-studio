import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BACKGROUND = [0xdf, 0xe7, 0xff];

function minimalGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Head" }] }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, padded]);
}

async function mockAvatarApi(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/api/avatar/concepts", (route) => {
    requests.push("concepts");
    return route.fulfill({ json: { ok: true, concepts: ["a", "b", "c"].map((id) => ({ id, image: PIXEL })) } });
  });
  await page.route("**/api/avatar", (route) => {
    const body: unknown = route.request().postDataJSON();
    requests.push(`start:${typeof body === "object" && body !== null && "conceptId" in body ? String(body.conceptId) : ""}`);
    return route.fulfill({ json: { ok: true, jobId: "job-e2e" } });
  });
  await page.route("**/api/avatar/job-e2e", (route) =>
    route.fulfill({ json: { ok: true, status: { jobId: "job-e2e", stage: "ready", progress: 100 } } }),
  );
  await page.route("**/api/avatar/job-e2e/model", (route) => {
    requests.push("model");
    return route.fulfill({ contentType: "model/gltf-binary", body: minimalGlb() });
  });
  return requests;
}

async function centerPixel(page: Page): Promise<number[]> {
  return page.locator("canvas.player__output").evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement) || node.width === 0) {
      return [];
    }
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d");
    ctx?.drawImage(node, node.width / 2, node.height / 2, 1, 1, 0, 0, 1, 1);
    return Array.from(ctx?.getImageData(0, 0, 1, 1).data.slice(0, 3) ?? []);
  });
}

const near = (pixel: number[], target: number[]) => pixel.length === 3 && pixel.every((value, i) => Math.abs(value - (target[i] ?? 0)) <= 12);

test("builds an avatar from a description and shows it in avatar mode", async ({ page }) => {
  const requests = await mockAvatarApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the Studio/ }).click();

  await page.getByLabel("Describe your character").fill("A cheerful fox barista");
  await page.getByRole("button", { name: /Draw 3 concepts/ }).click();
  await page.getByRole("button", { name: "Avatar concept 2" }).click();
  await expect(page.getByText(/daily avatar builds/)).toBeVisible();
  await page.getByRole("button", { name: "Build 3D avatar" }).click();
  await expect(page.getByText(/Your avatar is ready/)).toBeVisible();
  expect(requests).toEqual(["concepts", "start:b", "model"]);

  await page.getByRole("button", { name: /Start camera/ }).click();
  const toggle = page.getByRole("button", { name: /Avatar mode/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => near(await centerPixel(page), BACKGROUND), { timeout: 20_000 }).toBe(true);

  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => near(await centerPixel(page), BACKGROUND), { timeout: 20_000 }).toBe(false);
});

test("a refused build keeps the chosen concept and explains the limit", async ({ page }) => {
  await mockAvatarApi(page);
  await page.route("**/api/avatar", (route) =>
    route.fulfill({ status: 429, headers: { "retry-after": "3600" }, json: { ok: false, error: "avatar_daily_limit" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the Studio/ }).click();
  await page.getByLabel("Describe your character").fill("A robot DJ");
  await page.getByRole("button", { name: /Draw 3 concepts/ }).click();
  await page.getByRole("button", { name: "Avatar concept 1" }).click();
  await page.getByRole("button", { name: "Build 3D avatar" }).click();
  await expect(page.getByRole("alert")).toHaveText(/used today's avatar builds.*1h/);
  await expect(page.getByRole("button", { name: "Build 3D avatar" })).toBeVisible();
});
