import { describe, expect, it } from "vitest";
import {
  FOREHEAD,
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  createFrameGate,
  createHeadAnchor,
  eyeDistancePx,
  writeHeadAnchor,
} from "../src/scene/head-anchor.ts";
import { createHeadState } from "../src/tracking/head-state.ts";
import type { HeadState } from "../src/tracking/head-state.ts";

const VIEW = { width: 1000, height: 1000, mirror: false };

function setPoint(state: HeadState, index: number, x: number, y: number, z = 0) {
  state.landmarks[index * 3] = x;
  state.landmarks[index * 3 + 1] = y;
  state.landmarks[index * 3 + 2] = z;
}

function head(yawDeg = 0, eyeHalfWidth = 0.05): HeadState {
  const state = createHeadState();
  state.landmarkCount = 478;
  state.confidence = 1;
  const yaw = (yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  setPoint(state, RIGHT_EYE_OUTER, 0.5 - eyeHalfWidth * c, 0.5, eyeHalfWidth * s);
  setPoint(state, LEFT_EYE_OUTER, 0.5 + eyeHalfWidth * c, 0.5, -eyeHalfWidth * s);
  setPoint(state, FOREHEAD, 0.5 - 0.02 * s, 0.4);
  state.pose.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  return state;
}

describe("writeHeadAnchor", () => {
  it("places a centred face above the forehead", () => {
    const anchor = writeHeadAnchor(createHeadAnchor(), head(), VIEW);
    expect(anchor.visible).toBe(true);
    expect(anchor.x).toBeCloseTo(0);
    expect(anchor.y).toBeGreaterThan(100);
  });

  it("scales with eye distance", () => {
    const small = writeHeadAnchor(createHeadAnchor(), head(0, 0.05), VIEW).scale;
    const large = writeHeadAnchor(createHeadAnchor(), head(0, 0.1), VIEW).scale;
    expect(large).toBeCloseTo(small * 2);
  });

  it("keeps scale steady through yaw turns", () => {
    const front = eyeDistancePx(head(0), VIEW.width);
    expect(eyeDistancePx(head(30), VIEW.width)).toBeCloseTo(front);
    expect(eyeDistancePx(head(-30), VIEW.width)).toBeCloseTo(front);
  });

  it.each([-30, 30])("stays above the forehead at %d degrees yaw", (yaw) => {
    const state = head(yaw);
    const anchor = writeHeadAnchor(createHeadAnchor(), state, VIEW);
    const foreheadX = ((state.landmarks[FOREHEAD * 3] ?? 0) - 0.5) * VIEW.width;
    expect(anchor.visible).toBe(true);
    expect(anchor.y).toBeGreaterThan(100);
    expect(Math.abs(anchor.x - foreheadX)).toBeLessThan(1);
  });

  it("mirrors position and yaw", () => {
    const state = head(20);
    const plain = writeHeadAnchor(createHeadAnchor(), state, VIEW);
    const plainX = plain.x;
    const plainYawTerm = plain.rotation[8] ?? 0;
    const mirrored = writeHeadAnchor(createHeadAnchor(), state, { ...VIEW, mirror: true });
    expect(mirrored.x).toBeCloseTo(-plainX);
    expect(mirrored.rotation[8]).toBeCloseTo(-plainYawTerm);
    expect(mirrored.rotation[0]).toBeCloseTo(plain.rotation[0] ?? 0);
  });

  it("hides when no face or low confidence", () => {
    const anchor = createHeadAnchor();
    expect(writeHeadAnchor(anchor, null, VIEW).visible).toBe(false);
    const faint = head();
    faint.confidence = 0.2;
    expect(writeHeadAnchor(anchor, faint, VIEW).visible).toBe(false);
  });

  it("reuses the output object and rotation buffer", () => {
    const anchor = createHeadAnchor();
    const { rotation } = anchor;
    expect(writeHeadAnchor(anchor, head(10), VIEW)).toBe(anchor);
    expect(anchor.rotation).toBe(rotation);
  });
});

describe("createFrameGate", () => {
  it("passes about 30 of 60 display frames per second", () => {
    const gate = createFrameGate(30);
    let passed = 0;
    for (let i = 0; i < 60; i += 1) {
      if (gate(i * (1000 / 60))) {
        passed += 1;
      }
    }
    expect(passed).toBe(30);
  });

  it("caps a 120 Hz display at 30 fps", () => {
    const gate = createFrameGate(30);
    let passed = 0;
    for (let i = 0; i < 120; i += 1) {
      if (gate(i * (1000 / 120))) {
        passed += 1;
      }
    }
    expect(passed).toBe(30);
  });
});
