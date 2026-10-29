import { describe, expect, it } from "vitest";
import type { LookSpec } from "@look-studio/shared";
import {
  EXPORT_FORMAT,
  MAX_FAVORITES,
  MAX_IMPORT_BYTES,
  MAX_NAME_LENGTH,
  createFavorite,
  duplicateFavorite,
  exportFavorites,
  importFavorites,
  importMessage,
  parseFavorite,
  renameFavorite,
  sortFavorites,
} from "../src/studio/favorites.ts";
import type { Favorite, FavoriteDeps } from "../src/studio/favorites.ts";
import { MAX_GLYPHS, thumbnailModel } from "../src/studio/look-thumbnail.ts";
import { initialStudioState, studioReducer } from "../src/studio/studio-state.ts";

const look: LookSpec = {
  id: "look-1",
  name: "Golden Hour",
  style: "formal",
  palette: ["#FFD700", "#B76E79"],
  makeup: { lips: { color: "#B76E79", opacity: 0.8, finish: "satin" }, blush: { color: "#E8A88A", opacity: 0.4 } },
  wearables: [
    { id: "w1", type: "hat", label: "Tiara", anchor: { region: "head" } },
    { id: "w2", type: "glasses", label: "Shades", anchor: { region: "face" }, visible: false },
  ],
};

function testDeps(): FavoriteDeps {
  let clock = Date.parse("2026-10-28T12:00:00Z");
  let serial = 0;
  return {
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
    newId: () => {
      serial += 1;
      return `fav-${serial}`;
    },
  };
}

describe("favorites", () => {
  it("creates, renames, and duplicates", () => {
    const deps = testDeps();
    const favorite = createFavorite(look, deps);
    expect(favorite).toEqual({ id: "fav-1", name: "Golden Hour", look, savedAt: "2026-10-28T12:00:01.000Z" });
    expect(renameFavorite(favorite, "  Date   night  ").name).toBe("Date night");
    expect(renameFavorite(favorite, "   ").name).toBe("Golden Hour");
    expect(renameFavorite(favorite, "x".repeat(200)).name).toHaveLength(MAX_NAME_LENGTH);
    const copy = duplicateFavorite(favorite, deps);
    expect(copy).toMatchObject({ id: "fav-2", name: "Golden Hour copy", look });
    expect(sortFavorites([favorite, copy]).map((entry) => entry.id)).toEqual(["fav-2", "fav-1"]);
  });

  it("parses stored rows strictly", () => {
    const favorite = createFavorite(look, testDeps());
    expect(parseFavorite(JSON.parse(JSON.stringify(favorite)))).toEqual(favorite);
    expect(parseFavorite({ ...favorite, look: { id: "" } })).toBeNull();
    expect(parseFavorite({ ...favorite, savedAt: "yesterday" })).toBeNull();
    expect(parseFavorite({ ...favorite, id: 7 })).toBeNull();
    expect(parseFavorite(null)).toBeNull();
  });
});

describe("favorites export and import", () => {
  it("round-trips looks with fresh ids", () => {
    const deps = testDeps();
    const saved = [createFavorite(look, deps), createFavorite({ ...look, id: "look-2", name: "Rose" }, deps)];
    const text = exportFavorites(saved, new Date("2026-10-28T13:00:00Z"));
    expect(text).not.toContain("fav-1");
    const result = importFavorites(text, 0, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBe(0);
      expect(result.favorites.map((entry) => entry.look)).toEqual(saved.map((entry) => entry.look));
      expect(result.favorites.map((entry) => entry.name)).toEqual(["Golden Hour", "Rose"]);
      expect(result.favorites.map((entry) => entry.id)).toEqual(["fav-3", "fav-4"]);
    }
  });

  it("skips invalid entries and reports them", () => {
    const text = JSON.stringify({
      format: EXPORT_FORMAT,
      favorites: [{ name: "Good", look, savedAt: "2026-10-01T00:00:00Z" }, { name: "Bad", look: { id: "" }, savedAt: "x" }, 5],
    });
    const result = importFavorites(text, 0, testDeps());
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    expect(importMessage(result)).toBe("Imported 1 favorite. Skipped 2 that weren't valid looks.");
  });

  it("rejects bad files", () => {
    const deps = testDeps();
    expect(importFavorites("{nope", 0, deps)).toEqual({ ok: false, error: "invalid_json" });
    expect(importFavorites(JSON.stringify({ favorites: [] }), 0, deps)).toEqual({ ok: false, error: "wrong_format" });
    expect(importFavorites(" ".repeat(MAX_IMPORT_BYTES + 1), 0, deps)).toEqual({ ok: false, error: "too_large" });
    const two = JSON.stringify({ format: EXPORT_FORMAT, favorites: [{}, {}] });
    expect(importFavorites(two, MAX_FAVORITES - 1, deps)).toEqual({ ok: false, error: "too_many" });
    expect(importMessage({ ok: false, error: "too_many" })).toContain(String(MAX_FAVORITES));
  });
});

describe("look thumbnail", () => {
  it("uses only the look's own colours and visible wearables", () => {
    const model = thumbnailModel(look);
    expect(model.swatches).toEqual(["#FFD700", "#B76E79"]);
    expect(model.lips).toBe("#B76E79");
    expect(model.cheeks).toBe("#E8A88A");
    expect(model.eyes).toBe("#D9D4C7");
    expect(model.glyphs).toEqual(["♛"]);
    const crowded = { ...look, wearables: Array.from({ length: 9 }, (_v, i) => ({ ...look.wearables[0], id: `w${i}` })) };
    expect(thumbnailModel(crowded as LookSpec).glyphs).toHaveLength(MAX_GLYPHS);
  });
});

describe("wearing a favorite", () => {
  it("replaces the look and can be undone", () => {
    const favorite: Favorite = createFavorite(look, testDeps());
    let state = initialStudioState("9:00");
    state = studioReducer(state, { type: "look-loaded", at: "9:01", look: favorite.look, name: favorite.name });
    expect(state.look).toEqual(look);
    expect(state.messages.at(-1)?.text).toBe("Wearing favorite: Golden Hour.");
    state = studioReducer(state, { type: "undo", at: "9:02" });
    expect(state.look).toBeNull();
  });

  it("is ignored while a call is pending", () => {
    const pending = studioReducer(initialStudioState("9:00"), { type: "sent", at: "9:01", call: "look", text: "gold" });
    expect(studioReducer(pending, { type: "look-loaded", at: "9:02", look, name: "x" })).toBe(pending);
  });
});
