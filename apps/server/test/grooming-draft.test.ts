import { describe, expect, it } from "vitest";
import { DraftGrooming, SHADOW_COVER_CAP, toGrooming } from "../src/lib/grooming-draft.ts";
import type { DraftGrooming as Draft } from "../src/lib/grooming-draft.ts";
import { LookDraftJsonSchema, buildLookPrompt } from "../src/lib/look-draft.ts";

const bare: Draft = {
  facialHairStyle: "none",
  facialHairLength: 0,
  facialHairDensity: 0,
  facialHairColor: "",
  facialHairGrey: 0,
  browShape: "natural",
  shadowCover: 0,
};

describe("toGrooming", () => {
  it("omits grooming when nothing is asked for", () => {
    expect(toGrooming(bare)).toBeUndefined();
  });

  it("parses a short boxed salt-and-pepper beard", () => {
    expect(
      toGrooming({
        ...bare,
        facialHairStyle: "boxed",
        facialHairLength: 0.3,
        facialHairDensity: 0.8,
        facialHairColor: " #3b2a20 ",
        facialHairGrey: 0.5,
        browShape: "tidy",
      }),
    ).toEqual({ facialHair: { style: "boxed", length: 0.3, density: 0.8, color: "#3b2a20", grey: 0.5 }, brows: "tidy" });
  });

  it("clamps lengths, density, grey, and cover", () => {
    const grooming = toGrooming({
      ...bare,
      facialHairStyle: "full",
      facialHairLength: 9,
      facialHairDensity: 0,
      facialHairColor: "#222222",
      facialHairGrey: Number.NaN,
      shadowCover: 5,
    });
    expect(grooming?.facialHair).toMatchObject({ length: 1, density: 0.2, grey: 0 });
    expect(grooming?.shadowCover).toBe(SHADOW_COVER_CAP);
  });

  it("drops facial hair with an invalid colour and keeps a clean-shaven cover", () => {
    expect(toGrooming({ ...bare, facialHairStyle: "goatee", facialHairColor: "brown", shadowCover: 0.4 })).toEqual({ shadowCover: 0.4 });
    expect(toGrooming({ ...bare, shadowCover: -1 })).toBeUndefined();
  });
});

describe("grooming in the look draft", () => {
  it("is in the schema and the prompt", () => {
    expect(Object.keys(DraftGrooming.shape)).toHaveLength(7);
    expect(JSON.stringify(LookDraftJsonSchema)).toContain("facialHairStyle");
    const prompt = buildLookPrompt("short boxed beard, salt and pepper", false);
    expect(prompt).toContain("boxed, length 0.3");
    expect(prompt).toContain("can only be added, never removed");
  });
});
