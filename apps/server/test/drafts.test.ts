import { describe, expect, it } from "vitest";
import type { LookSpec } from "@look-studio/shared";
import { buildEditPrompt, draftToEditCommand } from "../src/lib/edit-draft.ts";
import type { EditDraft } from "../src/lib/edit-draft.ts";
import { buildLookPrompt, clampScale, draftToLookSpec, LookDraftJsonSchema } from "../src/lib/look-draft.ts";
import type { LookDraft } from "../src/lib/look-draft.ts";

const draft: LookDraft = {
  name: "  Gilded Hour ",
  description: "Warm gold accents.",
  style: "formal",
  palette: ["#FFD700", "gold", "#c0ffee", "#zzzzzz"],
  wearables: [{ type: "hat", label: "Crown", region: "head", scale: 1.2 }],
};

const look: LookSpec = {
  id: "look-1",
  name: "Gilded Hour",
  style: "formal",
  wearables: [{ id: "look-1-w1", type: "hat", label: "Crown", anchor: { region: "head" } }],
};

function edit(overrides: Partial<EditDraft>): EditDraft {
  return { op: "toggle", targetId: "look-1-w1", color: null, delta: null, factor: null, wearable: null, ...overrides };
}

describe("look drafts", () => {
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
});
