import { LookSpec } from "@look-studio/shared";

export const MAX_FAVORITES = 200;
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_NAME_LENGTH = 60;
export const EXPORT_FORMAT = "look-studio-favorites";
export const EXPORT_VERSION = 1;

export interface Favorite {
  id: string;
  name: string;
  look: LookSpec;
  savedAt: string;
}

export interface FavoriteDeps {
  now: () => Date;
  newId: () => string;
}

export function cleanName(name: string, fallback: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === "" ? fallback.slice(0, MAX_NAME_LENGTH) : trimmed;
}

export function createFavorite(look: LookSpec, deps: FavoriteDeps): Favorite {
  return { id: deps.newId(), name: cleanName(look.name, "Untitled look"), look, savedAt: deps.now().toISOString() };
}

export function renameFavorite(favorite: Favorite, name: string): Favorite {
  return { ...favorite, name: cleanName(name, favorite.name) };
}

export function duplicateFavorite(favorite: Favorite, deps: FavoriteDeps): Favorite {
  return {
    id: deps.newId(),
    name: cleanName(`${favorite.name} copy`, favorite.name),
    look: favorite.look,
    savedAt: deps.now().toISOString(),
  };
}

export function sortFavorites(favorites: Favorite[]): Favorite[] {
  return [...favorites].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseFavorite(value: unknown): Favorite | null {
  if (!isRecord(value) || typeof value["id"] !== "string" || value["id"] === "" || typeof value["name"] !== "string") {
    return null;
  }
  const savedAt = typeof value["savedAt"] === "string" ? value["savedAt"] : "";
  const look = LookSpec.safeParse(value["look"]);
  if (!look.success || Number.isNaN(Date.parse(savedAt))) {
    return null;
  }
  return { id: value["id"], name: cleanName(value["name"], look.data.name), look: look.data, savedAt };
}

export function exportFavorites(favorites: Favorite[], now: Date): string {
  const items = favorites.map(({ name, look, savedAt }) => ({ name, look, savedAt }));
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), favorites: items }, null, 2);
}

export type ImportResult =
  | { ok: true; favorites: Favorite[]; skipped: number }
  | { ok: false; error: "too_large" | "invalid_json" | "wrong_format" | "too_many" };

export function importFavorites(text: string, existing: number, deps: FavoriteDeps): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "too_large" };
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!isRecord(data) || data["format"] !== EXPORT_FORMAT || !Array.isArray(data["favorites"])) {
    return { ok: false, error: "wrong_format" };
  }
  const entries: unknown[] = data["favorites"];
  if (existing + entries.length > MAX_FAVORITES) {
    return { ok: false, error: "too_many" };
  }
  const favorites: Favorite[] = [];
  for (const entry of entries) {
    const parsed = parseFavorite(isRecord(entry) ? { ...entry, id: deps.newId() } : entry);
    if (parsed !== null) {
      favorites.push(parsed);
    }
  }
  return { ok: true, favorites, skipped: entries.length - favorites.length };
}

export function importMessage(result: ImportResult): string {
  if (result.ok) {
    const added = `Imported ${result.favorites.length} favorite${result.favorites.length === 1 ? "" : "s"}.`;
    return result.skipped === 0 ? added : `${added} Skipped ${result.skipped} that weren't valid looks.`;
  }
  switch (result.error) {
    case "too_large":
      return "That file is too large. Favorites files must be under 1 MB.";
    case "invalid_json":
      return "That file isn't valid JSON.";
    case "wrong_format":
      return "That file isn't a Look Studio favorites export.";
    case "too_many":
      return `That would go over the ${MAX_FAVORITES}-favorite limit. Delete some first.`;
  }
}
