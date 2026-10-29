import { describe, expect, it } from "vitest";
import type { LookSpec } from "@look-studio/shared";
import { buildEditPrompt, draftToEditCommand } from "../src/lib/edit-draft.ts";
import type { EditDraft } from "../src/lib/edit-draft.ts";
import { buildLookPrompt, clampScale, draftToLookSpec, LookDraftJsonSchema, MAKEUP_OPACITY_CAP, toMakeup } from "../src/lib/look-draft.ts";
import type { LookDraft } from "../src/lib/look-draft.ts";

const draft: LookDraft = {
  name: "  Gilded Hour ",
  description: "Warm gold accents.",
  style: "formal",
  palette: ["#FFD700", "gold", "#c0ffee", "#zzzzzz"],
  wearables: [{ type: "hat", label: "Crown", region: "head", scale: 1.2 }],  makeup: {
    lipColor: "#c2185b",
    lipOpacity: 0.7,
    lipFinish: "gloss",
    blushColor: "#ff8a80",
    blushOpacity: 0.3,
    shadowColor: "#7e57c2",
    shadowOpacity: 0.5,
    shadowFinish: "shimmer",
    browColor: "#4e342e",
    browOpacity: 0.4,
  },
};

const look: LookSpec = {
  id: "look-1",
  name: "Gilded Hour",
  style: "formal",
  wearables: [{ id: "look-1-w1", type: "hat", label: "Crown", anchor: { region: "head" } }],
};

function edit(overrides: Partial<EditDraft>): EditDraft {
  return { op: "toggle", targetId: "look-1-w1", color: null, delta: null, factor: null, opacity: null, wearable: null, ...overrides };
}

describe("look drafts", () => {
  it("maps makeup layers onto the LookSpec", () => {
    const spec = draftToLookSpec(draft, "look-1");
    expect(spec?.makeup?.lips).toEqual({ color: "#c2185b", opacity: 0.7, finish: "gloss" });
    expect(spec?.makeup?.eyeshadow?.finish).toBe("shimmer");
  });

  it("caps makeup opacity and drops bare or invalid layers", () => {
    const makeup = toMakeup({
      ...draft.makeup,
      lipOpacity: 4,
      blushColor: "pink",
      shadowOpacity: 0,
      browOpacity: Number.NaN,
    });
    expect(makeup?.lips?.opacity).toBe(MAKEUP_OPACITY_CAP.lips);
    expect(makeup?.blush).toBeUndefined();
    expect(makeup?.eyeshadow).toBeUndefined();
    expect(makeup?.brows).toBeUndefined();
  });

  it("omits makeup when every layer is bare", () => {
    const bare = { ...draft.makeup, lipOpacity: 0, blushOpacity: 0, shadowOpacity: 0, browOpacity: 0 };
    expect(draftToLookSpec({ ...draft, makeup: bare }, "look-3")?.makeup).toBeUndefined();
  });

  it("maps a draft to a LookSpec, keeping only valid colours", () => {
    const spec = draftToLookSpec(draft, "look-1");
    expect(spec?.name).toBe("Gilded Hour");
    expect(spec?.palette).toEqual(["#FFD700", "#c0ffee"]);
    expect(spec?.wearables[0]).toEqual({
      id: "look-1-w1",
      type: "hat",
      label: "Crown",
      anchor: { region: "head" },
      scale: 1.2,
      visible: true,
    });
  });

  it("clamps counts, text, and scale from untrusted output", () => {
    const wearables = Array.from({ length: 9 }, () => ({ type: "hat" as const, label: " ", region: "head" as const, scale: 99 }));
    const spec = draftToLookSpec({ ...draft, name: "", description: " ", palette: [], wearables }, "look-2");
    expect(spec?.name).toBe("Untitled look");
    expect(spec?.description).toBeUndefined();
    expect(spec?.palette).toBeUndefined();
    expect(spec?.wearables).toHaveLength(4);
    expect(spec?.wearables[0].label).toBe("hat");
    expect(spec?.wearables[0].scale).toBe(3);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(-2)).toBe(1);
  });

  it("builds a prompt with safety rules and the image hint", () => {
    expect(buildLookPrompt("gold crown", true)).toContain("reference photo is attached");
    expect(buildLookPrompt("gold crown", false)).toContain("Never describe, rate, or comment");
  });

  it("exports a strict, shallow JSON schema", () => {
    expect(LookDraftJsonSchema["additionalProperties"]).toBe(false);
    expect(JSON.stringify(LookDraftJsonSchema)).not.toContain("$ref");
  });
});

describe("edit drafts", () => {
  it("lists current wearables in the prompt", () => {
    expect(buildEditPrompt("make it red", look)).toContain("look-1-w1: Crown (hat, head)");
  });

  it("resolves each op against the current look", () => {
    expect(draftToEditCommand(edit({ op: "toggle" }), look, "n")).toEqual({ op: "toggle", targetId: "look-1-w1" });
    expect(draftToEditCommand(edit({ op: "recolor", color: "#ff0000" }), look, "n")?.color).toBe("#ff0000");
    expect(draftToEditCommand(edit({ op: "scale", factor: 10 }), look, "n")?.factor).toBe(4);
    expect(draftToEditCommand(edit({ op: "move", delta: { x: 2, y: 0.1, z: -9 } }), look, "n")?.delta).toEqual({
      x: 0.5,
      y: 0.1,
      z: -0.5,
    });
    const added = draftToEditCommand(
      edit({ op: "add", targetId: "new", wearable: { type: "glasses", label: "Hearts", region: "face" } }),
      look,
      "look-1-w-x",
    );
    expect(added?.targetId).toBe("look-1-w-x");
    expect(added?.wearable?.anchor.region).toBe("face");
  });

  it("returns null for edits it cannot resolve", () => {
    expect(draftToEditCommand(edit({ targetId: "missing" }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "recolor", color: "red" }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "move" }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "scale", factor: 0 }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "add", targetId: "new" }), look, "n")).toBeNull();
  });

  it("lists current makeup in the prompt", () => {
    const prompt = buildEditPrompt("pink brows", { ...look, makeup: { brows: { color: "#4e342e", opacity: 0.4 } } });
    expect(prompt).toContain("- brows: #4e342e at opacity 0.4");
    expect(prompt).toContain("- lips: bare");
  });

  it("resolves makeup edits with the area caps", () => {
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "brows", color: "#ff69b4", opacity: 2 }), look, "n")).toEqual({
      op: "makeup",
      targetId: "brows",
      color: "#ff69b4",
      opacity: MAKEUP_OPACITY_CAP.brows,
    });
    expect(draftToEditCommand(edit({ op: "makeup", targetId: " lips ", color: "#0000ff" }), look, "n")).toEqual({
      op: "makeup",
      targetId: "lips",
      color: "#0000ff",
      opacity: MAKEUP_OPACITY_CAP.lips * 0.75,
    });
    const withLips = { ...look, makeup: { lips: { color: "#aa0000", opacity: 0.6, finish: "matte" as const } } };
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "lips", color: "#0000ff" }), withLips, "n")).toEqual({
      op: "makeup",
      targetId: "lips",
      color: "#0000ff",
    });
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "blush", opacity: -1 }), look, "n")).toEqual({
      op: "makeup",
      targetId: "blush",
      opacity: 0,
    });
  });

  it("rejects makeup edits without an area or a change", () => {
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "hair", color: "#ff69b4" }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "brows", color: "pink" }), look, "n")).toBeNull();
    expect(draftToEditCommand(edit({ op: "makeup", targetId: "brows", opacity: Number.NaN }), look, "n")).toBeNull();
  });
});
