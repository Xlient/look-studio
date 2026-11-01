import { describe, expect, it } from "vitest";
import { FACE_FROM_TOP, HEAD_SHARE, frameBust } from "../src/scene/avatar-framing.ts";

const FOV = 30;
const body = { minY: 0, maxY: 1.8, centerX: 0, centerZ: 0, depth: 0.4 };
const halfHeightAt = (distance: number) => distance * Math.tan((FOV * Math.PI) / 360);

describe("frameBust", () => {
  it("puts the head in the upper part of the frame at about a third of its height", () => {
    const frame = frameBust(body, { x: 0.02, y: 1.55 }, FOV);
    const visible = 2 * halfHeightAt(frame.z - body.depth / 2);
    const top = frame.lookY + visible / 2;
    const faceY = 1.55 + 0.25 / 2;
    expect(0.25 / visible).toBeCloseTo(HEAD_SHARE, 5);
    expect((top - faceY) / visible).toBeCloseTo(FACE_FROM_TOP, 5);
    expect(top).toBeGreaterThan(body.maxY);
    expect(frame.x).toBe(0.02);
    expect(frame.y).toBe(frame.lookY);
  });

  it("falls back to framing the top of the body without a usable head bone", () => {
    const fallback = frameBust(body, null, FOV);
    expect(frameBust(body, { x: 0, y: 1.9 }, FOV)).toEqual(fallback);
    expect(frameBust(body, { x: 0, y: 0.5 }, FOV)).toEqual(fallback);
    const visible = 2 * halfHeightAt(fallback.z - body.depth / 2);
    expect(visible).toBeCloseTo(1.8 * 0.42, 5);
  });

  it("keeps near and far planes around the camera distance", () => {
    const frame = frameBust(body, { x: 0, y: 1.55 }, FOV);
    expect(frame.near).toBeGreaterThan(0);
    expect(frame.near).toBeLessThan(frame.z);
    expect(frame.far).toBeGreaterThan(frame.z);
  });
});
