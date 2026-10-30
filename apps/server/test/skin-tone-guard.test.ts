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
    "make my skin look white",
    "look more asian",
    "help me look black",
    "make her look white",
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
    "make my glasses white",
    "make the glasses look white",
    "make my glasses look more white",
    "I want the hat to look black",
    "make them white",
    "make my eyebrows a little lighter",
    "",
  ])("allows %j", (text) => {
    expect(asksToChangeSkinTone(text)).toBe(false);
  });
});
