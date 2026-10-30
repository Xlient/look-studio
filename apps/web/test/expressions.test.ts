import { describe, expect, it } from "vitest";
import { EXPRESSION, EXPRESSION_COUNT, stepExpressions, toAvatarExpressions, writeExpressions } from "../src/tracking/expressions.ts";

const fresh = () => new Float32Array(EXPRESSION_COUNT);

describe("writeExpressions", () => {
  it("combines sides, applies the dead zone, and ignores other shapes", () => {
    const out = writeExpressions(fresh(), [
      { categoryName: "mouthSmileLeft", score: 0.7 },
      { categoryName: "mouthSmileRight", score: 0.7 },
      { categoryName: "eyeBlinkLeft", score: 0.2 },
      { categoryName: "eyeBlinkRight", score: 0.45 },
      { categoryName: "cheekPuff", score: 1 },
    ]);
    expect(out[EXPRESSION.smile]).toBeCloseTo(1);
    expect(out[EXPRESSION.blinkA]).toBe(0);
    expect(out[EXPRESSION.blinkB]).toBeCloseTo(0.5);
  });

  it("clears on missing scores and survives garbage", () => {
    const out = fresh().fill(1);
    expect(Array.from(writeExpressions(out, undefined))).toEqual(Array.from(fresh()));
    expect(writeExpressions(out, [{ categoryName: "jawOpen", score: Number.NaN }])[EXPRESSION.jawOpen]).toBe(0);
  });
});

describe("toAvatarExpressions", () => {
  const tracked = fresh();
  tracked[EXPRESSION.blinkA] = 1;
  tracked[EXPRESSION.squintB] = 0.5;

  it("puts the tracked left eye on the screen's left when mirrored and the right when not", () => {
    const mirrored = toAvatarExpressions(fresh(), tracked, true);
    expect(mirrored[EXPRESSION.blinkA]).toBe(1);
    expect(mirrored[EXPRESSION.blinkB]).toBe(0);
    const plain = toAvatarExpressions(fresh(), tracked, false);
    expect(plain[EXPRESSION.blinkA]).toBe(0);
    expect(plain[EXPRESSION.blinkB]).toBe(1);
    expect(plain[EXPRESSION.squintA]).toBe(0.5);
  });

  it("drops squint on a closed eye so the lid and the bend do not fight", () => {
    const both = fresh();
    both[EXPRESSION.blinkA] = 1;
    both[EXPRESSION.squintA] = 1;
    expect(toAvatarExpressions(fresh(), both, true)[EXPRESSION.squintA]).toBe(0);
  });
});

describe("stepExpressions", () => {
  it("eases to the target, back to rest when lost, and holds on a bad time step", () => {
    const current = fresh();
    const target = fresh().fill(1);
    stepExpressions(current, target, Number.NaN);
    expect(current[0]).toBe(0);
    for (let i = 0; i < 30; i += 1) {
      stepExpressions(current, target, 1 / 30);
    }
    expect(current[0]).toBeCloseTo(1, 3);
    for (let i = 0; i < 30; i += 1) {
      stepExpressions(current, null, 1 / 30);
    }
    expect(current[0]).toBeCloseTo(0, 3);
  });
});
