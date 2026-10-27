import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LookSpec } from "@look-studio/shared";
import App from "../src/App.tsx";
import CameraPreview from "../src/components/CameraPreview.tsx";
import PlaceholderPanel from "../src/components/PlaceholderPanel.tsx";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("web smoke", () => {
  it("exports the page components", () => {
    expect(typeof App).toBe("function");
    expect(typeof CameraPreview).toBe("function");
    expect(typeof PlaceholderPanel).toBe("function");
  });

  it("never references the server model key in client sources", () => {
    const srcDir = new URL("../src", import.meta.url).pathname;
    for (const file of listFiles(srcDir)) {
      expect(readFileSync(file, "utf8")).not.toContain("MODEL_API_KEY");
    }
  });

  it("parses a LookSpec through the shared workspace package", () => {
    const parsed = LookSpec.safeParse({
      id: "smoke",
      name: "Smoke",
      wearables: [],
      style: "casual",
    });
    expect(parsed.success).toBe(true);
  });
});
