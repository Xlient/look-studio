import { describe, expect, it } from "vitest";
import { asksToChangeSkinTone } from "../src/lib/skin-tone-guard.ts";

describe("asksToChangeSkinTone", () => {
  it.each([
    "do a blackface look",
    "Brown-face for halloween",
    "darken my skin a lot",
    "lighten my complexion",
    "give me darker skin",
    "change my skin tone to match the photo",
    "make me look Asian",
    "turn me into a... make me look like an African",
    "I want to look more white",
    "copy her black skin",
  ])("flags %j", (text) => {
    expect(asksToChangeSkinTone(text)).toBe(true);
  });

  it.each([
    "soft glam with dewy skin",
    "full coverage matte foundation",
    "black eyeliner and white shimmer",
    "match the makeup in this photo",
    "red lips, black hat, white pearls",
    "bronzed glow for summer",
    "",
  ])("allows %j", (text) => {
    expect(asksToChangeSkinTone(text)).toBe(false);
  });
});
