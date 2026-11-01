import { describe, expect, it } from "vitest";
import { FACE_FROM_TOP, HEAD_SHARE, frameBust } from "../src/scene/avatar-framing.ts";

const FOV = 30;
const body = { minX: -0.4, maxX: 0.4, minY: 0, maxY: 1.8, minZ: -0.2, maxZ: 0.2 };
const head = { minX: -0.1, maxX: 0.14, minY: 1.5, maxY: 1.78, minZ: -0.1, maxZ: 0.12 };
const visibleAt = (frame: { z: number; lookZ: number }, depth: number) => 2 * (frame.z - frame.lookZ - depth / 2) * Math.tan((FOV * Math.PI) / 360);

describe("frameBust", () => {
  it("frames the head's own vertices: a third of the frame, centre a little above the middle", () => {
    const frame = frameBust(body, head, FOV);
    const visible = visibleAt(frame, 0.22);
    const faceY = (1.5 + 1.78) / 2;
    expect(frame.mode).toBe("head");
    expect(0.28 / visible).toBeCloseTo(HEAD_SHARE, 5);
    expect((frame.lookY + visible / 2 - faceY) / visible).toBeCloseTo(FACE_FROM_TOP, 5);
    expect(frame.x).toBeCloseTo(0.02, 5);
    expect(frame.lookZ).toBeCloseTo(0.01, 5);
  });

  it("ignores a whole-model box inflated by stray geometry when the head is known", () => {
    const inflated = { ...body, minY: -5, maxY: 9, minZ: -3, maxZ: 3 };
    expect(frameBust(inflated, head, FOV)).toEqual(frameBust(body, head, FOV));
  });

  it("falls back to the top of the body without usable head vertices", () => {
    const fallback = frameBust(body, null, FOV);
    expect(fallback.mode).toBe("body");
    expect(frameBust(body, { ...head, maxY: head.minY }, FOV)).toEqual(fallback);
    expect(visibleAt(fallback, 0.4)).toBeCloseTo(1.8 * 0.42, 5);
  });

  it("keeps near and far planes around the camera distance", () => {
    const frame = frameBust(body, head, FOV);
    expect(frame.near).toBeGreaterThan(0);
    expect(frame.far).toBeGreaterThan(frame.z - frame.lookZ);
  });
});
