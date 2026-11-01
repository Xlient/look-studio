import { describe, expect, it } from "vitest";
import { VRM_EXPRESSIONS, writeVrmWeights } from "../src/scene/vrm-expressions.ts";
import { EXPRESSION, EXPRESSION_COUNT } from "../src/tracking/expressions.ts";
import { checkModelFile, modelFileMessage } from "../src/studio/model-file.ts";

function weights(set: Partial<Record<keyof typeof EXPRESSION, number>>) {
  const expressions = new Float32Array(EXPRESSION_COUNT);
  for (const [name, value] of Object.entries(set)) {
    expressions[EXPRESSION[name as keyof typeof EXPRESSION]] = value;
  }
  const out = writeVrmWeights(new Float32Array(VRM_EXPRESSIONS.length), expressions);
  return Object.fromEntries(VRM_EXPRESSIONS.map((name, index) => [name, out[index] ?? 0]));
}

describe("writeVrmWeights", () => {
  it("rests at zero", () => {
    expect(Object.values(weights({})).every((value) => value === 0)).toBe(true);
  });

  it("opens to aa, rounds to ou, and blends to oh", () => {
    expect(weights({ jawOpen: 1 })).toMatchObject({ aa: 1, oh: 0, ou: 0 });
    expect(weights({ mouthRound: 1 })).toMatchObject({ aa: 0, oh: 0, ou: 1 });
    expect(weights({ jawOpen: 1, mouthRound: 1 })).toMatchObject({ aa: 0, oh: 1, ou: 0 });
  });

  it("maps screen-side blinks onto the avatar's own eyes", () => {
    expect(weights({ blinkA: 1 })).toMatchObject({ blinkRight: 1, blinkLeft: 0 });
    expect(weights({ blinkB: 1 })).toMatchObject({ blinkLeft: 1, blinkRight: 0 });
  });

  it("softens a smile while talking, scales brows, and clamps bad input", () => {
    expect(weights({ smile: 1 }).happy).toBe(1);
    expect(weights({ smile: 1, jawOpen: 1 }).happy).toBeCloseTo(0.5);
    expect(weights({ browRaise: 1 }).surprised).toBeCloseTo(0.6);
    expect(weights({ jawOpen: Number.NaN, smile: 7 })).toMatchObject({ aa: 0, happy: 1 });
  });
});

describe("checkModelFile", () => {
  it("accepts VRM and GLB files up to 60 MB", () => {
    expect(checkModelFile({ name: "Me.VRM", size: 10 })).toBeNull();
    expect(checkModelFile({ name: "robot.glb", size: 60_000_000 })).toBeNull();
  });

  it("rejects other types, empty files, and oversized files", () => {
    expect(checkModelFile({ name: "face.png", size: 10 })).toBe("type");
    expect(checkModelFile({ name: "me.vrm", size: 0 })).toBe("size");
    expect(checkModelFile({ name: "me.vrm", size: 60_000_001 })).toBe("size");
    expect(modelFileMessage("type")).toMatch(/\.vrm/);
  });
});
