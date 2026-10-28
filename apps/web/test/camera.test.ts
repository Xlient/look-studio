import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterVideoDevices,
  mapGetUserMediaError,
  statusMessage,
} from "../src/tracking/camera.ts";
import type { CameraStatus } from "../src/tracking/camera.ts";

function rejection(name: string): DOMException {
  return new DOMException("denied", name);
}

describe("filterVideoDevices", () => {
  it("keeps video inputs and numbers empty labels", () => {
    expect(
      filterVideoDevices([
        { kind: "videoinput", label: "", deviceId: "a" },
        { kind: "audioinput", label: "Mic", deviceId: "b" },
        { kind: "videoinput", label: "FaceTime", deviceId: "c" },
      ]),
    ).toEqual([
      { deviceId: "a", label: "Camera 1" },
      { deviceId: "c", label: "FaceTime" },
    ]);
  });

  it("excludes OBS Virtual Camera by label", () => {
    expect(
      filterVideoDevices([
        { kind: "videoinput", label: "OBS Virtual Camera", deviceId: "a" },
        { kind: "videoinput", label: "USB OBS Virtual Camera 4K", deviceId: "b" },
        { kind: "videoinput", label: "Cam Link", deviceId: "c" },
      ]),
    ).toEqual([{ deviceId: "c", label: "Cam Link" }]);
  });
});

describe("mapGetUserMediaError", () => {
  it("maps denial names", () => {
    expect(mapGetUserMediaError(rejection("NotAllowedError"))).toBe("denied");
    expect(mapGetUserMediaError(rejection("SecurityError"))).toBe("denied");
  });

  it("maps missing-device names", () => {
    expect(mapGetUserMediaError(rejection("NotFoundError"))).toBe("no-device");
    expect(mapGetUserMediaError(rejection("OverconstrainedError"))).toBe("no-device");
  });

  it("maps busy-device names", () => {
    expect(mapGetUserMediaError(rejection("NotReadableError"))).toBe("in-use");
    expect(mapGetUserMediaError(rejection("AbortError"))).toBe("in-use");
  });

  it("maps anything else to unknown", () => {
    expect(mapGetUserMediaError(rejection("TypeError"))).toBe("unknown");
    expect(mapGetUserMediaError(new Error("boom"))).toBe("unknown");
    expect(mapGetUserMediaError(undefined)).toBe("unknown");
  });
});

describe("statusMessage", () => {
  it("describes every status", () => {
    const statuses: CameraStatus[] = [
      "prompt",
      "requesting",
      "live",
      "denied",
      "no-device",
      "in-use",
      "sample",
      "error",
    ];
    for (const status of statuses) {
      expect(typeof statusMessage(status)).toBe("string");
      expect(statusMessage(status).length).toBeGreaterThan(0);
    }
  });

  it("names the permission states clearly", () => {
    expect(statusMessage("denied")).toContain("denied");
    expect(statusMessage("no-device")).toContain("No camera");
    expect(statusMessage("in-use")).toContain("in use");
    expect(statusMessage("prompt")).toContain("off");
  });
});

describe("camera privacy", () => {
  it("keeps frames local: no network or capture calls in camera sources", () => {
    const sources = ["../src/tracking/camera.ts", "../src/components/CameraPreview.tsx"].map(
      (file) => readFileSync(new URL(file, import.meta.url).pathname, "utf8"),
    );
    for (const source of sources) {
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("XMLHttpRequest");
      expect(source).not.toContain("drawImage");
      expect(source).not.toContain("toDataURL");
      expect(source).not.toContain("captureStream");
    }
  });
});
