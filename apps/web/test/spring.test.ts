import { describe, expect, it } from "vitest";
import { createHeadAnchor } from "../src/scene/head-anchor.ts";
import { MAX_DT_S, SPRING_LIMITS, clampSpringParams, createSpring, stepSpring } from "../src/scene/spring.ts";
import { WOBBLE_PARAMS, createWobble, stepWobble } from "../src/scene/wobble.ts";

const FRAME_S = 1 / 30;
const soft = { stiffness: 70, damping: 5 };

function settle(seconds: number, dtS: number, params = soft) {
  const spring = createSpring();
  spring.position = 1;
  const steps = Math.round(seconds / dtS);
  for (let i = 0; i < steps; i += 1) {
    stepSpring(spring, 0, params, dtS);
  }
  return spring;
}

describe("stepSpring", () => {
  it("overshoots, then settles on the target", () => {
    const spring = createSpring();
    spring.position = 1;
    let lowest = 1;
    for (let i = 0; i < 30; i += 1) {
      lowest = Math.min(lowest, stepSpring(spring, 0, soft, FRAME_S).position);
    }
    expect(lowest).toBeLessThan(0);
    const settled = settle(4, FRAME_S);
    expect(Math.abs(settled.position)).toBeLessThan(0.01);
    expect(Math.abs(settled.velocity)).toBeLessThan(0.05);
  });

  it("gives the same motion whatever the frame rate", () => {
    expect(settle(0.5, 1 / 30).position).toBeCloseTo(settle(0.5, 1 / 60).position, 2);
  });

  it("stays stable with huge, zero, or invalid time steps", () => {
    const stiff = clampSpringParams({ stiffness: 1e9, damping: 1e9 });
    for (const dtS of [10, 1, MAX_DT_S]) {
      const spring = settle(20, dtS, stiff);
      expect(Number.isFinite(spring.position)).toBe(true);
      expect(Math.abs(spring.position)).toBeLessThan(1);
    }
    const spring = createSpring();
    spring.position = 0.5;
    for (const dtS of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      stepSpring(spring, 0, soft, dtS);
    }
    expect(spring).toEqual({ position: 0.5, velocity: 0 });
    stepSpring(spring, Number.NaN, soft, FRAME_S);
    expect(spring.position).toBe(0.5);
  });

  it("clamps stiffness and damping, including bad values", () => {
    expect(clampSpringParams({ stiffness: 1e6, damping: -3 })).toEqual({
      stiffness: SPRING_LIMITS.stiffness.max,
      damping: SPRING_LIMITS.damping.min,
    });
    expect(clampSpringParams({ stiffness: Number.NaN, damping: 12 })).toEqual({ stiffness: SPRING_LIMITS.stiffness.min, damping: 12 });
    for (const params of Object.values(WOBBLE_PARAMS)) {
      expect(clampSpringParams(params)).toEqual({ stiffness: params.stiffness, damping: params.damping });
    }
  });
});

describe("stepWobble", () => {
  function turnHead(wobble = createWobble(), params = WOBBLE_PARAMS.hat) {
    const anchor = createHeadAnchor();
    anchor.visible = true;
    anchor.scale = 100;
    let peak = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      anchor.x = frame < 10 ? frame * 30 : 270;
      stepWobble(wobble, anchor, FRAME_S, params);
      peak = Math.max(peak, Math.abs(wobble.roll.position));
    }
    return { wobble, peak, anchor };
  }

  it("swings on a head turn and settles once the head stops", () => {
    const { wobble, peak } = turnHead();
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(WOBBLE_PARAMS.hat.maxAngle);
    expect(Math.abs(wobble.roll.position)).toBeLessThan(0.005);
  });

  it("moves a crown less than a hat", () => {
    expect(turnHead(createWobble(), WOBBLE_PARAMS.crown).peak).toBeLessThan(turnHead().peak);
  });

  it("rests when off or when the face is lost, and does not jump on return", () => {
    const { wobble, anchor } = turnHead();
    wobble.roll.position = 0.2;
    stepWobble(wobble, anchor, FRAME_S, null);
    expect(wobble.roll).toEqual({ position: 0, velocity: 0 });
    anchor.visible = false;
    stepWobble(wobble, anchor, FRAME_S, WOBBLE_PARAMS.hat);
    anchor.visible = true;
    anchor.x = 5000;
    stepWobble(wobble, anchor, FRAME_S, WOBBLE_PARAMS.hat);
    stepWobble(wobble, anchor, FRAME_S, WOBBLE_PARAMS.hat);
    expect(wobble.roll.position).toBe(0);
  });

  it("allocates nothing new per frame", () => {
    const wobble = createWobble();
    const { roll, pitch } = wobble;
    turnHead(wobble);
    expect(wobble.roll).toBe(roll);
    expect(wobble.pitch).toBe(pitch);
  });
});
