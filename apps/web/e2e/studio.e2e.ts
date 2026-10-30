import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const LOOK = {
  id: "look-e2e",
  name: "Coral Heart Flirt",
  style: "casual",
  palette: ["#FF6F61"],
  makeup: { lips: { color: "#FF6F61", opacity: 0.8, finish: "gloss" }, skin: { smoothing: 0.4, coverage: "light", finish: "dewy" } },
  wearables: [{ id: "look-e2e-w1", type: "hat", label: "Crown", anchor: { region: "head" }, visible: true }],
};

const META = {
  model: "muse-spark-1.3",
  latencyMs: 1234,
  tokens: { input: 100, output: 50, total: 150 },
  requestId: "req-e2e",
  attempts: 1,
};

function sse(events: [string | null, unknown][]): string {
  return events.map(([event, data]) => `${event === null ? "" : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`).join("");
}

async function mockApi(page: Page): Promise<string[]> {
  const prompts: string[] = [];
  await page.route("**/api/look/stream", (route) => {
    const body: unknown = route.request().postDataJSON();
    prompts.push(typeof body === "object" && body !== null && "chat" in body ? String(body.chat) : "");
    return route.fulfill({
      contentType: "text/event-stream",
      body: sse([["delta", { text: "Coral and " }], ["delta", { text: "hearts." }], ["look", { look: LOOK, meta: META }]]),
    });
  });
  await page.route("**/api/wearable", (route) => route.fulfill({ json: { ok: true, jobId: "job-e2e" } }));
  await page.route("**/api/wearable/*/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: sse([
        [null, { jobId: "job-e2e", state: "running", progress: { completed: 1, total: 2 } }],
        [null, { jobId: "job-e2e", state: "succeeded" }],
      ]),
    }),
  );
  return prompts;
}

async function enterStudio(page: Page): Promise<string[]> {
  const prompts = await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the Studio/ }).click();
  return prompts;
}

async function tabTo(page: Page, target: Locator, limit = 80) {
  for (let i = 0; i < limit; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("element not reachable with Tab");
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

test("one message can revise makeup and a wearable together, and undo takes it all back", async ({ page }) => {
  await page.route("**/api/edit", (route) =>
    route.fulfill({
      json: {
        ok: true,
        meta: META,
        edits: {
          commands: [
            { op: "makeup", targetId: "lips", color: "#C76B6B", opacity: 0.45 },
            { op: "recolor", targetId: "look-e2e-w1", color: "#FFFFFF" },
          ],
          skipped: 0,
        },
      },
    }),
  );
  await enterStudio(page);
  await page.getByLabel("Message LookArtist").fill("Heart shades + coral lips");
  await page.getByRole("button", { name: /Send/ }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText(LOOK.name);
  await page.getByLabel("Message LookArtist").fill("subtler lipstick and make the crown white");
  await page.getByRole("button", { name: /Send/ }).click();
  await expect(log).toContainText("Changed lips to #C76B6B. Switched Crown to #FFFFFF.");
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByRole("button", { name: /Redo/ })).toBeEnabled();
});

test("the touch-up slider follows the look and works from the keyboard", async ({ page }) => {
  await enterStudio(page);
  const slider = page.getByRole("slider", { name: /Touch-up/ });
  await expect(slider).toHaveValue("0");
  await page.getByLabel("Message LookArtist").fill("Glam touch-up");
  await page.getByRole("button", { name: /Send/ }).click();
  await expect(slider).toHaveValue("40");
  await expect(page.getByLabel("Coverage")).toHaveValue("light");
  await page.getByLabel("Coverage").selectOption("full");
  await expect(page.getByLabel("Coverage")).toHaveValue("full");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("45");
  await expect(slider).toHaveAttribute("aria-valuetext", "45%");
});

test("shows LookArtist working on the chat and camera, and cancels", async ({ page }) => {
  await enterStudio(page);
  await page.route("**/api/look/stream", () => undefined);
  await page.getByRole("button", { name: /Start camera/ }).click();
  await page.getByLabel("Message LookArtist").fill("Pink brows");
  await page.getByRole("button", { name: /Send/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "LookArtist is designing your look" })).toBeVisible();
  await expect(page.locator(".player__thinking")).toContainText("designing your look");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Request cancelled.");
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(page.locator(".player__thinking")).toHaveCount(0);
  await expect(page.getByLabel("Model call log")).not.toContainText("aborted");
});

test("the wobble toggle is on by default and works from the keyboard", async ({ page }) => {
  await enterStudio(page);
  const wobble = page.getByRole("button", { name: /Wobble/ });
  await expect(wobble).toHaveAttribute("aria-pressed", "true");
  await wobble.focus();
  await page.keyboard.press("Enter");
  await expect(wobble).toHaveAttribute("aria-pressed", "false");
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

test("the whole chat flow works with the keyboard only", async ({ page }) => {
  const prompts = await mockApi(page);
  await page.goto("/");
  await tabTo(page, page.getByRole("button", { name: /Enter the Studio/ }));
  await page.keyboard.press("Enter");

  const party = page.getByRole("button", { name: "Party" });
  await tabTo(page, party);
  await page.keyboard.press("Space");
  await expect(party).toHaveAttribute("aria-pressed", "true");

  await tabTo(page, page.getByLabel("Vibe"));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".vibe__value")).toHaveText("bold");

  await tabTo(page, page.getByLabel("Message LookArtist"));
  await page.keyboard.type("Coral glow");
  await page.keyboard.press("Enter");
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText(LOOK.name);
  await expect(log).toContainText("[party · bold]");
  expect(prompts[0]).toContain("Occasion: party.");
  expect(prompts[0]).toContain("Vibe: 80/100 (bold)");
  await expect(page.getByRole("list", { name: "Wearable jobs" })).toContainText("Crownpassed");

  await tabTo(page, page.getByRole("button", { name: /Undo/ }));
  await page.keyboard.press("Enter");
  await expect(log).toContainText("Undo: back to the plain camera.");
  await page.keyboard.press("Control+Shift+Z");
  await expect(log).toContainText(`Redo: back to ${LOOK.name}.`);

  const plain = page.getByRole("button", { name: /Plain camera/ });
  await tabTo(page, plain);
  await page.keyboard.press("Space");
  await expect(plain).toHaveAttribute("aria-pressed", "true");

  const attach = page.getByRole("button", { name: "Attach photo" });
  await tabTo(page, attach);
  await page.keyboard.press("Enter");
  const consent = page.getByRole("alertdialog", { name: "Before you attach a photo" });
  await expect(consent).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(consent).toHaveCount(0);
  await expect(attach).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /I agree/ })).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await (await chooser).setFiles({ name: "ref.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Attached ref.png.")).toBeVisible();
});

test("favorites survive a reload and round-trip through export", async ({ page }) => {
  await enterStudio(page);
  await page.getByLabel("Message LookArtist").fill("Coral glow");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText(LOOK.name);
  await page.getByRole("button", { name: "♥ Save look" }).click();

  const saved = page.getByRole("list", { name: "Saved looks" });
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(`Saved ${LOOK.name}.`)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Enter the Studio/ }).click();
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await expect(saved).toContainText(LOOK.name);

  await saved.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByLabel(`New name for ${LOOK.name}`);
  await rename.fill("Date night");
  await rename.press("Enter");
  await expect(saved).toContainText("Date night");
  await saved.getByRole("button", { name: "Duplicate" }).click();
  await expect(saved.getByRole("listitem")).toHaveCount(2);
  await expect(saved).toContainText("Date night copy");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const exported = await (await downloading).path();

  for (let remaining = 2; remaining > 0; remaining -= 1) {
    await saved.getByRole("button", { name: "Delete" }).first().click();
    await page.keyboard.press("Enter");
    await expect(saved.getByRole("listitem")).toHaveCount(remaining - 1);
  }
  await expect(page.getByText("No favorites yet.")).toBeVisible();

  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  await (await choosing).setFiles(exported);
  await expect(page.getByText("Imported 2 favorites.")).toBeVisible();
  await expect(saved.getByRole("listitem")).toHaveCount(2);

  await saved.getByRole("button", { name: "Wear" }).first().click();
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Wearing favorite:");
});
