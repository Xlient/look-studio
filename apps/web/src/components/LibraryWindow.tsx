import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { LookSpec } from "@look-studio/shared";
import { MAX_NAME_LENGTH } from "../studio/favorites.ts";
import type { Favorite } from "../studio/favorites.ts";
import type { LibraryStatus } from "../studio/use-favorites.ts";
import LookThumbnail from "./LookThumbnail.tsx";
import Window from "./Window.tsx";

interface LibraryWindowProps {
  favorites: Favorite[];
  status: LibraryStatus;
  notice: string | null;
  canWear: boolean;
  onWear: (look: LookSpec, name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onExport: () => string;
  onImport: (text: string) => void;
}

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "look-studio-favorites.json";
  link.click();
  URL.revokeObjectURL(url);
}

function savedLabel(savedAt: string): string {
  return new Date(savedAt).toLocaleDateString([], { month: "short", day: "numeric" });
}

interface RowProps {
  favorite: Favorite;
  canWear: boolean;
  onWear: LibraryWindowProps["onWear"];
  onRename: LibraryWindowProps["onRename"];
  onDuplicate: LibraryWindowProps["onDuplicate"];
  onRemove: LibraryWindowProps["onRemove"];
}

function FavoriteRow({ favorite, canWear, onWear, onRename, onDuplicate, onRemove }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(favorite.name);
  const [confirming, setConfirming] = useState(false);
  const renameRef = useRef<HTMLButtonElement | null>(null);
  const editingRef = useRef(false);

  const finish = (save: boolean) => {
    // Removing the focused input fires blur after Enter or Escape already finished.
    if (!editingRef.current) {
      return;
    }
    editingRef.current = false;
    if (save) {
      onRename(favorite.id, draft);
    }
    setEditing(false);
    renameRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finish(event.key === "Enter");
    }
  };

  return (
    <li className="fav">
      <LookThumbnail look={favorite.look} />
      <div className="fav__info">
        {editing ? (
          <input
            className="fav__rename"
            aria-label={`New name for ${favorite.name}`}
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => finish(true)}
          />
        ) : (
          <strong className="fav__name">{favorite.name}</strong>
        )}
        <span className="fav__date">Saved {savedLabel(favorite.savedAt)}</span>
      </div>
      <div className="fav__actions" role="group" aria-label={`${favorite.name} actions`}>
        <button type="button" className="btn btn--small" disabled={!canWear} onClick={() => onWear(favorite.look, favorite.name)}>
          Wear
        </button>
        <button
          ref={renameRef}
          type="button"
          className="btn btn--small"
          onClick={() => {
            setDraft(favorite.name);
            editingRef.current = true;
            setEditing(true);
          }}
        >
          Rename
        </button>
        <button type="button" className="btn btn--small" onClick={() => onDuplicate(favorite.id)}>
          Duplicate
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn--small btn--danger" autoFocus onClick={() => onRemove(favorite.id)}>
              Confirm delete
            </button>
            <button type="button" className="btn btn--small" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--small" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export default function LibraryWindow(props: LibraryWindowProps) {
  const { favorites, status, notice, canWear, onWear, onRename, onDuplicate, onRemove, onExport, onImport } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const importFile = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    try {
      onImport(await file.text());
      setReadError(null);
    } catch {
      setReadError("Couldn't read that file.");
    }
  };

  const footer =
    status === "loading" ? "Opening favorites…" : status === "unavailable" ? "Favorites can't be saved in this browser." : `${favorites.length} saved`;

  return (
    <Window id="library" title="Favorites" icon="♥" flavor="lime" className="win--library" status={footer}>
      <div className="library__toolbar">
        <button type="button" className="btn btn--small" disabled={favorites.length === 0} onClick={() => download(onExport())}>
          Export
        </button>
        <button type="button" className="btn btn--small" disabled={status !== "ready"} onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Favorites file"
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {(readError ?? notice) !== null && (
        <p className="library__notice" role="status">
          {readError ?? notice}
        </p>
      )}
      {favorites.length === 0 ? (
        <p className="library__empty">No favorites yet. Use ♥ Save look in the chat to keep one.</p>
      ) : (
        <ul className="library__list" aria-label="Saved looks">
          {favorites.map((favorite) => (
            <FavoriteRow
              key={favorite.id}
              favorite={favorite}
              canWear={canWear}
              onWear={onWear}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Window>
  );
}
