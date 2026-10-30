import { parseSkinChoice } from "./prompt-compose.ts";
import type { SkinChoice } from "./prompt-compose.ts";

const STORAGE_KEY = "look-studio.skin-choice";

export type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStorage: StorageAccess = () => window.localStorage;

export function loadSkinChoice(storage: StorageAccess = browserStorage): SkinChoice {
  try {
    const saved = storage().getItem(STORAGE_KEY);
    return saved === null ? {} : parseSkinChoice(JSON.parse(saved));
  } catch {
    return {};
  }
}

export function saveSkinChoice(choice: SkinChoice, storage: StorageAccess = browserStorage): boolean {
  try {
    if (choice.tone === undefined && choice.undertone === undefined) {
      storage().removeItem(STORAGE_KEY);
    } else {
      storage().setItem(STORAGE_KEY, JSON.stringify(choice));
    }
    return true;
  } catch {
    return false;
  }
}
