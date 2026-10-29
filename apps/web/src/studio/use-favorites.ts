import { useCallback, useEffect, useRef, useState } from "react";
import type { LookSpec } from "@look-studio/shared";
import {
  MAX_FAVORITES,
  createFavorite,
  duplicateFavorite,
  exportFavorites,
  importFavorites,
  importMessage,
  renameFavorite,
  sortFavorites,
} from "./favorites.ts";
import type { Favorite, FavoriteDeps } from "./favorites.ts";
import { createIndexedDbFavoritesStore } from "./favorites-store.ts";
import type { FavoritesStore } from "./favorites-store.ts";

export type LibraryStatus = "loading" | "ready" | "unavailable";

const STORAGE_FAILED = "Couldn't save favorites in this browser. Changes last until you reload.";

const defaultDeps: FavoriteDeps = { now: () => new Date(), newId: () => crypto.randomUUID() };

function defaultStore(): FavoritesStore | null {
  return typeof indexedDB === "undefined" ? null : createIndexedDbFavoritesStore(indexedDB);
}

export function useFavorites(createStore: () => FavoritesStore | null = defaultStore, deps: FavoriteDeps = defaultDeps) {
  const [store] = useState(createStore);
  const storeRef = useRef(store);
  const depsRef = useRef(deps);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [status, setStatus] = useState<LibraryStatus>(store === null ? "unavailable" : "loading");
  const [notice, setNotice] = useState<string | null>(null);
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;

  useEffect(() => {
    const active = storeRef.current;
    if (active === null) {
      return;
    }
    let cancelled = false;
    active.list().then(
      (loaded) => {
        if (!cancelled) {
          setFavorites(sortFavorites(loaded));
          setStatus("ready");
        }
      },
      () => {
        if (!cancelled) {
          setStatus("unavailable");
          setNotice("Couldn't open saved favorites in this browser.");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (write: (active: FavoritesStore) => Promise<void>): Promise<boolean> => {
    const active = storeRef.current;
    if (active === null) {
      return false;
    }
    try {
      await write(active);
      return true;
    } catch {
      setNotice(STORAGE_FAILED);
      return false;
    }
  }, []);

  const add = useCallback(
    (added: Favorite[]) => {
      setFavorites((current) => sortFavorites([...added, ...current]));
      return persist((active) => active.put(added));
    },
    [persist],
  );

  const save = useCallback(
    (look: LookSpec) => {
      if (favoritesRef.current.length >= MAX_FAVORITES) {
        setNotice(`You can keep up to ${MAX_FAVORITES} favorites. Delete one first.`);
        return;
      }
      void add([createFavorite(look, depsRef.current)]).then((stored) => {
        if (stored) {
          setNotice(`Saved ${look.name}.`);
        }
      });
    },
    [add],
  );

  const update = useCallback(
    (id: string, change: (favorite: Favorite) => Favorite) => {
      const favorite = favoritesRef.current.find((entry) => entry.id === id);
      if (favorite === undefined) {
        return;
      }
      const next = change(favorite);
      setFavorites((current) => current.map((entry) => (entry.id === id ? next : entry)));
      void persist((active) => active.put([next]));
    },
    [persist],
  );

  const rename = useCallback((id: string, name: string) => update(id, (favorite) => renameFavorite(favorite, name)), [update]);

  const duplicate = useCallback(
    (id: string) => {
      const favorite = favoritesRef.current.find((entry) => entry.id === id);
      if (favorite !== undefined && favoritesRef.current.length < MAX_FAVORITES) {
        void add([duplicateFavorite(favorite, depsRef.current)]);
      }
    },
    [add],
  );

  const remove = useCallback(
    (id: string) => {
      setFavorites((current) => current.filter((entry) => entry.id !== id));
      void persist((active) => active.remove(id));
    },
    [persist],
  );

  const exportJson = useCallback(() => exportFavorites(favoritesRef.current, depsRef.current.now()), []);

  const importJson = useCallback(
    (text: string) => {
      const result = importFavorites(text, favoritesRef.current.length, depsRef.current);
      if (result.ok && result.favorites.length > 0) {
        void add(result.favorites).then((stored) => {
          if (stored) {
            setNotice(importMessage(result));
          }
        });
        return;
      }
      setNotice(importMessage(result));
    },
    [add],
  );

  return { favorites, status, notice, save, rename, duplicate, remove, exportJson, importJson };
}
