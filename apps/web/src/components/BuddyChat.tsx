import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { LookSpec } from "@look-studio/shared";
import { checkPhoto, photoProblemMessage, readPhoto } from "../studio/photo.ts";
import type { ChatMessage } from "../studio/studio-state.ts";
import type { OutgoingPhoto } from "../studio/use-studio.ts";
import Window from "./Window.tsx";

const SUGGESTIONS = ["Golden crown + warm glow", "Heart shades + coral lips", "Flower crown + rosy blush"];

const SCREEN_NAMES: Record<ChatMessage["from"], string> = {
  artist: "LookArtist",
  you: "You",
  system: "*** Look Studio",
};

interface BuddyChatProps {
  messages: ChatMessage[];
  pending: boolean;
  hasLook: boolean;
  online: boolean | null;
  onSend: (text: string, photo: OutgoingPhoto | null) => Promise<void>;
  onReset: () => void;
}

function LookCard({ look }: { look: LookSpec }) {
  return (
    <div className="look-card">
      <strong className="look-card__name">{look.name}</strong>
      <span className="look-card__style">{look.style}</span>
      {look.palette !== undefined && (
        <ul className="look-card__palette" aria-label="Palette">
          {look.palette.map((color) => (
            <li key={color} style={{ background: color }} title={color}>
              <span className="sr-only">{color}</span>
            </li>
          ))}
        </ul>
      )}
      {look.wearables.length > 0 && (
        <ul className="look-card__items">
          {look.wearables.map((wearable) => (
            <li key={wearable.id} className={wearable.visible === false ? "is-hidden" : undefined}>
              {wearable.label} <em>({wearable.anchor.region})</em>
              {wearable.visible === false && " — hidden"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BuddyChat({ messages, pending, hasLook, online, onSend, onReset }: BuddyChatProps) {
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<OutgoingPhoto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || pending) {
      return;
    }
    setDraft("");
    setPhoto(null);
    setNotice(null);
    await onSend(trimmed, photo);
  };

  const attach = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    const problem = checkPhoto(file);
    if (problem !== null) {
      setNotice(photoProblemMessage(problem));
      return;
    }
    try {
      setPhoto({ name: file.name, dataUrl: await readPhoto(file) });
      setNotice(null);
    } catch {
      setNotice("Couldn't read that photo. Try another one.");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit(draft);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(draft);
  };

  return (
    <Window
      id="chat"
      title="LookArtist - Instant Message"
      icon="✦"
      flavor="tangerine"
      className="win--chat"
      status={pending ? "LookArtist is typing..." : hasLook ? "Ask for an edit, or start a new look." : "Describe a vibe to start."}
    >
      <div className="buddy">
        <span className="buddy__icon" aria-hidden="true">
          ✦
        </span>
        <div>
          <strong className="buddy__name">LookArtist</strong>
          <span className={`buddy__presence ${online === false ? "is-away" : "is-live"}`}>
            {online === false ? "Away · offline demo (no API key)" : "Online · Meta Muse Spark"}
          </span>
        </div>
        <button type="button" className="btn btn--small" onClick={onReset} disabled={!hasLook || pending}>
          New look
        </button>
      </div>
      <ol className="im-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((message) => (
          <li key={message.id} className={`im-line im-line--${message.from}`}>
            <span className="im-line__sn">{SCREEN_NAMES[message.from]}</span>
            <span className="im-line__time"> ({message.at})</span>: {message.text}
            {message.attachment !== undefined && <span className="im-line__file"> [photo: {message.attachment}]</span>}
            {message.look !== undefined && <LookCard look={message.look} />}
          </li>
        ))}
      </ol>
      <div className="chips" role="group" aria-label="Suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="chip" disabled={pending} onClick={() => void submit(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <form className="im-compose" onSubmit={onSubmit}>
        <label htmlFor="im-input" className="sr-only">
          Message LookArtist
        </label>
        <textarea
          id="im-input"
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder={hasLook ? 'Try "move the crown higher"' : "Describe a look..."}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="im-compose__actions">
          <label className="btn btn--small btn--file">
            {photo === null ? "Attach photo" : "Photo ✓"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                void attach(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <button type="submit" className="btn btn--send" disabled={pending || draft.trim() === ""}>
            Send
          </button>
        </div>
      </form>
      {notice !== null && (
        <p className="im-notice" role="alert">
          {notice}
        </p>
      )}
      {photo !== null && (
        <p className="im-notice">
          Attached {photo.name}.{" "}
          <button type="button" className="link-btn" onClick={() => setPhoto(null)}>
            Remove
          </button>
        </p>
      )}
    </Window>
  );
}
