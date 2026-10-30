import { describe, expect, it } from "vitest";
import { GUESSED_FACE, anchorsFromEstimate, anchorsFromLandmarks, matchEyes, measureEye } from "../src/scene/avatar-face-anchors.ts";
import type { Rgb, RgbaImage } from "../src/scene/avatar-face-anchors.ts";

const SKIN: Rgb = [240, 200, 170];
const SIZE = 100;

function image(paint: (x: number, y: number) => Rgb | null): RgbaImage {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      data.set([...(paint(x, y) ?? SKIN), 255], (y * SIZE + x) * 4);
    }
  }
  return { data, width: SIZE, height: SIZE };
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

describe("measureEye", () => {
  it("reads the painted eye's real extent from a seed inside it", () => {
    const inEye = ellipse(30, 40, 10, 14);
    const box = measureEye(image((x, y) => (inEye(x, y) ? [255, 255, 255] : null)), 30, 35, SKIN, 25);
    expect(box).toEqual({ minX: 20, maxX: 40, minY: 26, maxY: 54 });
  });

  it("gives up on skin seeds, specks and fills that leak out of the search area", () => {
    expect(measureEye(image(() => null), 30, 40, SKIN, 25)).toBeNull();
    const speck = image((x, y) => (x === 30 && y === 40 ? [0, 0, 0] : null));
    expect(measureEye(speck, 30, 40, SKIN, 25)).toBeNull();
    expect(measureEye(image(() => [0, 0, 0]), 30, 40, SKIN, 25)).toBeNull();
  });
});

describe("matchEyes", () => {
  const big = { minX: -0.4, maxX: -0.1, minY: 0, maxY: 0.3 };
  const small = { minX: 0.15, maxX: 0.25, minY: 0.1, maxY: 0.2 };

  it("mirrors the larger eye over a mismeasured one", () => {
    const { right } = matchEyes(big, small, 0);
    expect(right.minX).toBeCloseTo(0.1);
    expect(right.maxX).toBeCloseTo(0.4);
    expect(right.maxY).toBeCloseTo(0.3);
  });

  it("leaves similar eyes alone", () => {
    const close = { minX: 0.1, maxX: 0.38, minY: 0, maxY: 0.3 };
    expect(matchEyes(big, close, 0)).toEqual({ left: big, right: close });
  });
});

describe("anchorsFromLandmarks", () => {
  it("maps image coordinates to world space, flipping y", () => {
    const inEye = ellipse(30, 40, 10, 14);
    const shot = image((x, y) => (inEye(x, y) ? [255, 255, 255] : null));
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.2 }));
    for (const i of [33, 133, 159, 145]) landmarks[i] = { x: 0.3, y: 0.38 };
    for (const i of [362, 263, 386, 374]) landmarks[i] = { x: 0.7, y: 0.38 };
    landmarks[61] = { x: 0.4, y: 0.75 };
    const anchors = anchorsFromLandmarks(landmarks, shot, { centerX: 1, centerY: 2, size: 2 });
    expect(anchors.mouthLeft.x).toBeCloseTo(0.8);
    expect(anchors.mouthLeft.y).toBeCloseTo(1.5);
    expect(anchors.eyeLeft.minX).toBeCloseTo(0.4);
    expect(anchors.eyeLeft.maxY).toBeCloseTo(2.48);
    expect(anchors.eyeLeft.minY).toBeCloseTo(1.9);
    expect(anchors.lidLeft).toEqual(SKIN);
  });

  it("falls back to the tracker's eye points when the pixels can't be read", () => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.2 }));
    landmarks[33] = { x: 0.25, y: 0.4 };
    landmarks[133] = { x: 0.35, y: 0.4 };
    landmarks[159] = { x: 0.3, y: 0.35 };
    landmarks[145] = { x: 0.3, y: 0.45 };
    const anchors = anchorsFromLandmarks(landmarks, image(() => null), { centerX: 0.5, centerY: 0.5, size: 1 });
    expect(anchors.eyeLeft.minX).toBeCloseTo(0.25);
    expect(anchors.eyeLeft.maxX).toBeCloseTo(0.35);
  });
});

describe("anchorsFromEstimate", () => {
  it("keeps every feature inside the frame even with extreme estimates", () => {
    const anchors = anchorsFromEstimate({ ...GUESSED_FACE, mouth: { x: 0.5, y: 2 } }, { centerX: 0, centerY: 0, size: 1 }, SKIN);
    expect(anchors.eyeLeft.maxX).toBeLessThan(anchors.eyeRight.minX);
    expect(anchors.mouthBottom.y).toBeGreaterThanOrEqual(-0.5);
  });
});
