import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const LOOK = {
  id: "look-e2e",
  name: "Coral Heart Flirt",
  style: "casual",
  palette: ["#FF6F61"],
  makeup: { lips: { color: "#FF6F61", opacity: 0.8, finish: "gloss" } },
  wearables: [{ id: "look-e2e-w1", type: "hat", label: "Crown", anchor: { region: "head" }, visible: true }],
};

const META = {
  model: "muse-spark-1.3",
  latencyMs: 1234,
  tokens: { input: 100, output: 50, total: 150 },
  requestId: "req-e2e",
  attempts: 1,
};

async function enterStudio(page: Page) {
  await page.route("**/api/look", (route) => route.fulfill({ json: { ok: true, look: LOOK, meta: META } }));
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the Studio/ }).click();
}

async function canvasHasPixels(page: Page): Promise<boolean> {
  return page.locator("canvas.player__output").evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement) || node.width === 0) {
      return false;
    }
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 32;
    const ctx = probe.getContext("2d");
    if (ctx === null) {
      return false;
    }
    ctx.drawImage(node, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      lit += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 30 ? 1 : 0;
    }
    return lit > 100;
  });
}

test("splash leads into the studio desktop", async ({ page }) => {
  await enterStudio(page);
  await expect(page.getByText("LookCam Player 2000")).toBeVisible();
  await expect(page.getByLabel("Message LookArtist")).toBeVisible();
  await expect(page.getByLabel("Meta models in Look Studio")).toBeVisible();
});

test("camera goes live, tracks, and renders the output canvas", async ({ page }) => {
  await enterStudio(page);
  await page.getByRole("button", { name: /Start camera/ }).click();
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await expect(page.locator(".player__track")).toHaveText(/FPS/, { timeout: 45_000 });
  await expect.poll(() => canvasHasPixels(page), { timeout: 15_000 }).toBe(true);
});

test("a chat request logs the Muse call and shows the look", async ({ page }) => {
  await enterStudio(page);
  await page.getByLabel("Message LookArtist").fill("Heart shades + coral lips");
  await page.getByRole("button", { name: /Send/ }).click();
  await expect(page.getByLabel("Model call log")).toContainText("muse-spark-1.3");
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText(LOOK.name);
  await page.getByRole("button", { name: /Start camera/ }).click();
  await expect(page.locator(".player__ticker")).toContainText(`NOW WEARING: ${LOOK.name}`);
});

test("sample video mode works without a camera", async ({ page }) => {
  await enterStudio(page);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    for (let frame = 0; frame < 15; frame += 1) {
      if (ctx !== null) {
        ctx.fillStyle = `hsl(${frame * 20} 70% 50%)`;
        ctx.fillRect(0, 0, 320, 240);
      }
      await new Promise((resolve) => setTimeout(resolve, 66));
    }
    recorder.stop();
    await done;
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]');
    if (input === null) {
      throw new Error("sample video input missing");
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File(chunks, "sample.webm", { type: "video/webm" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator(".player__idle")).toHaveCount(0);
  await expect.poll(() => canvasHasPixels(page), { timeout: 15_000 }).toBe(true);
});
