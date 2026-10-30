import { describe, expect, it } from "vitest";
import { buildFaceShapes, buildHeightField } from "../src/scene/avatar-shapes.ts";
import type { FaceAnchors } from "../src/scene/avatar-face-anchors.ts";

const ANCHORS: FaceAnchors = {
  eyeLeft: { minX: -0.3, maxX: -0.1, minY: 0.1, maxY: 0.3 },
  eyeRight: { minX: 0.1, maxX: 0.3, minY: 0.1, maxY: 0.3 },
  browLeft: { x: -0.2, y: 0.45 },
  browRight: { x: 0.2, y: 0.45 },
  mouthLeft: { x: -0.15, y: -0.3 },
  mouthRight: { x: 0.15, y: -0.3 },
  mouthTop: { x: 0, y: -0.28 },
  mouthBottom: { x: 0, y: -0.36 },
  chin: { x: 0, y: -0.6 },
  lidLeft: [240, 200, 170],
  lidRight: [240, 200, 170],
};

// Named probes plus far corners, so the height field spans the whole head.
const PROBES = {
  mouthLeft: [-0.15, -0.3, 0],
  mouthRight: [0.15, -0.3, 0],
  brow: [-0.2, 0.45, 0],
  belowEye: [-0.2, 0.05, 0],
  eyeTop: [-0.2, 0.28, 0],
  eyeBottom: [-0.2, 0.12, 0],
  otherEye: [0.2, 0.28, 0],
  chin: [0, -0.55, 0],
  forehead: [0, 0.9, 0],
  backOfMouth: [-0.15, -0.3, -0.5],
  cornerA: [-1, -1, 0],
  cornerB: [1, 1, 0],
} as const;
const NAMES = Object.keys(PROBES) as (keyof typeof PROBES)[];
const positions = new Float32Array(NAMES.flatMap((name) => [...PROBES[name]]));
const at = (name: keyof typeof PROBES) => NAMES.indexOf(name);

function build(weights = new Float32Array(NAMES.length).fill(1)) {
  return buildFaceShapes(positions, weights, ANCHORS, buildHeightField(positions, weights));
}

const dy = (shape: Float32Array, name: keyof typeof PROBES) => shape[at(name) * 3 + 1] ?? 0;
const dx = (shape: Float32Array, name: keyof typeof PROBES) => shape[at(name) * 3] ?? 0;

describe("buildFaceShapes", () => {
  it("lifts the mouth corners up and outward", () => {
    const { smile } = build();
    expect(dy(smile, "mouthLeft")).toBeGreaterThan(0);
    expect(dy(smile, "mouthRight")).toBeCloseTo(dy(smile, "mouthLeft"));
    expect(dx(smile, "mouthLeft")).toBeLessThan(0);
    expect(dx(smile, "mouthRight")).toBeGreaterThan(0);
    expect(dy(smile, "forehead")).toBe(0);
  });

  it("raises the brows without pulling the eyes", () => {
    const { browRaise } = build();
    expect(dy(browRaise, "brow")).toBeGreaterThan(0);
    expect(dy(browRaise, "belowEye")).toBe(0);
  });

  it("drops the chin only for the jaw", () => {
    const { jawOpen } = build();
    expect(dy(jawOpen, "chin")).toBeLessThan(0);
    expect(dy(jawOpen, "brow")).toBeCloseTo(0);
  });

  it("squeezes one eye towards its centre and leaves the other alone", () => {
    const { squintLeft } = build();
    expect(dy(squintLeft, "eyeTop")).toBeLessThan(0);
    expect(dy(squintLeft, "eyeBottom")).toBeGreaterThan(0);
    expect(dy(squintLeft, "otherEye")).toBeCloseTo(0);
  });

  it("skips hidden surfaces and vertices off the head", () => {
    expect(dy(build().smile, "backOfMouth")).toBe(0);
    const weights = new Float32Array(NAMES.length).fill(1);
    weights[at("mouthLeft")] = 0;
    expect(dy(build(weights).smile, "mouthLeft")).toBe(0);
  });
});

describe("buildHeightField", () => {
  it("returns the front-most depth and null outside the head", () => {
    const field = buildHeightField(positions, new Float32Array(NAMES.length).fill(1));
    expect(field.sample(-0.15, -0.3)).toBe(0);
    expect(field.sample(5, 5)).toBeNull();
  });
});
