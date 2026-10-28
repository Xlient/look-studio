import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { LookSpec } from "@look-studio/shared";
import { checkPhoto, photoProblemMessage, readPhoto } from "../studio/photo.ts";
import { COMPOSE_TEXT_MAX, VIBE_DEFAULT } from "../studio/prompt-compose.ts";
import type { LookContext, Occasion } from "../studio/prompt-compose.ts";
import type { ChatMessage } from "../studio/studio-state.ts";
import type { OutgoingPhoto } from "../studio/use-studio.ts";
import type { WearableJob } from "../studio/wearable-jobs.ts";
import ConsentPrompt from "./ConsentPrompt.tsx";
import JobList from "./JobList.tsx";
import VibeControls from "./VibeControls.tsx";
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
  streaming: string;
  hasLook: boolean;
  canUndo: boolean;
  canRedo: boolean;
  online: boolean | null;
  jobs: WearableJob[];
  onSend: (text: string, photo: OutgoingPhoto | null, context: LookContext) => Promise<void>;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
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

export default function BuddyChat(props: BuddyChatProps) {
  const { messages, pending, streaming, hasLook, canUndo, canRedo, online, jobs, onSend, onReset, onUndo, onRedo } = props;
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<OutgoingPhoto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [vibe, setVibe] = useState(VIBE_DEFAULT);
  const [consented, setConsented] = useState(false);
  const [asking, setAsking] = useState(false);
  const logRef = useRef<HTMLOListElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const attachRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, streaming]);

  const chooseFile = () => {
    if (consented) {
      fileRef.current?.click();
    } else {
      setAsking(true);
    }
  };

  const closeConsent = (agreed: boolean) => {
    setAsking(false);
    setConsented(agreed);
    attachRef.current?.focus();
    if (agreed) {
      fileRef.current?.click();
    }
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || pending) {
      return;
    }
    setDraft("");
    setPhoto(null);
    setNotice(null);
    await onSend(trimmed, photo, { occasion, vibe });
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
        <div className="buddy__actions">
          <button type="button" className="btn btn--small" onClick={onUndo} disabled={!canUndo} aria-keyshortcuts="Control+Z Meta+Z">
            ↶ Undo
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={onRedo}
            disabled={!canRedo}
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          >
            ↷ Redo
          </button>
          <button type="button" className="btn btn--small" onClick={onReset} disabled={!hasLook || pending}>
            New look
          </button>
        </div>
      </div>
      <ol className="im-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((message) => (
          <li key={message.id} className={`im-line im-line--${message.from}`}>
            <span className="im-line__sn">{SCREEN_NAMES[message.from]}</span>
            <span className="im-line__time"> ({message.at})</span>: {message.text}
            {message.attachment !== undefined && <span className="im-line__file"> [photo: {message.attachment}]</span>}
            {message.note !== undefined && <span className="im-line__note"> [{message.note}]</span>}
            {message.look !== undefined && <LookCard look={message.look} />}
          </li>
        ))}
        {pending && streaming !== "" && (
          <li className="im-line im-line--artist im-line--streaming" aria-hidden="true">
            <span className="im-line__sn">{SCREEN_NAMES.artist}</span>: {streaming}
            <span className="im-caret">▍</span>
          </li>
        )}
      </ol>
      <JobList jobs={jobs} />
      <div className="chips" role="group" aria-label="Suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="chip" disabled={pending} onClick={() => void submit(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <VibeControls occasion={occasion} vibe={vibe} disabled={pending} onOccasion={setOccasion} onVibe={setVibe} />
      <form className="im-compose" onSubmit={onSubmit}>
        <label htmlFor="im-input" className="sr-only">
          Message LookArtist
        </label>
        <textarea
          id="im-input"
          rows={2}
          maxLength={COMPOSE_TEXT_MAX}
          value={draft}
          placeholder={hasLook ? 'Try "move the crown higher"' : "Describe a look..."}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="im-compose__actions">
          <button ref={attachRef} type="button" className="btn btn--small" onClick={chooseFile} aria-expanded={asking}>
            {photo === null ? "Attach photo" : "Photo ✓"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Reference photo"
            onChange={(event) => {
              void attach(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button type="submit" className="btn btn--send" disabled={pending || draft.trim() === ""}>
            Send
          </button>
        </div>
      </form>
      {asking && <ConsentPrompt onAgree={() => closeConsent(true)} onCancel={() => closeConsent(false)} />}
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
