import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

interface ConsentPromptProps {
  onAgree: () => void;
  onCancel: () => void;
}

export default function ConsentPrompt({ onAgree, onCancel }: ConsentPromptProps) {
  const agreeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    agreeRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="consent" role="alertdialog" aria-labelledby="consent-title" aria-describedby="consent-body" onKeyDown={onKeyDown}>
      <strong id="consent-title">Before you attach a photo</strong>
      <p id="consent-body">
        The photo is sent once to Meta Muse Spark to read its colours and style. Look Studio doesn't store it. Only use
        photos you have the right to share.
      </p>
      <div className="consent__actions">
        <button ref={agreeRef} type="button" className="btn btn--small" onClick={onAgree}>
          I agree, choose photo
        </button>
        <button type="button" className="btn btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
