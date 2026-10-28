import { parseFavorite } from "./favorites.ts";
import type { Favorite } from "./favorites.ts";

export interface FavoritesStore {
  list(): Promise<Favorite[]>;
  put(favorites: Favorite[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export class FavoritesStoreError extends Error {
  constructor(action: string, cause?: unknown) {
    super(`favorites_${action}_failed`, { cause });
    this.name = "FavoritesStoreError";
  }
}

const DB_NAME = "look-studio";
const DB_VERSION = 1;
const STORE = "favorites";

function settle<T>(request: IDBRequest<T>, action: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new FavoritesStoreError(action, request.error));
  });
}

function finish(transaction: IDBTransaction, action: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new FavoritesStoreError(action, transaction.error));
    transaction.onabort = () => reject(new FavoritesStoreError(action, transaction.error));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    }
  };
  return settle(request, "open");
}

export function createIndexedDbFavoritesStore(factory: IDBFactory = indexedDB): FavoritesStore {
  let database: Promise<IDBDatabase> | null = null;
  const db = () => {
    database ??= openDatabase(factory).catch((error: unknown) => {
      database = null;
      throw error;
    });
    return database;
  };
  return {
    async list() {
      const rows: unknown[] = await settle((await db()).transaction(STORE, "readonly").objectStore(STORE).getAll(), "list");
      return rows.map(parseFavorite).filter((favorite): favorite is Favorite => favorite !== null);
    },
    async put(favorites) {
      const transaction = (await db()).transaction(STORE, "readwrite");
      const done = finish(transaction, "put");
      for (const favorite of favorites) {
        transaction.objectStore(STORE).put(favorite);
      }
      await done;
    },
    async remove(id) {
      const transaction = (await db()).transaction(STORE, "readwrite");
      const done = finish(transaction, "remove");
      transaction.objectStore(STORE).delete(id);
      await done;
    },
  };
}
