import { defineConfig, devices } from "@playwright/test";

const port = 5199;
const baseURL = process.env["E2E_BASE_URL"] ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    permissions: ["camera"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: process.env["E2E_BASE_URL"]
    ? undefined
    : {
        command: `node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`,
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env["CI"],
      },
});
