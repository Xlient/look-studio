import { useEffect, useState } from "react";
import type { CallKind } from "../studio/studio-state.ts";
import { thinkingStatus } from "../studio/thinking.ts";

const TICK_MS = 500;

export default function ThinkingBubble({
  call,
  typicalMs,
  onCancel,
}: {
  call: CallKind;
  typicalMs: number | null;
  onCancel: () => void;
}) {
  const [startedAt] = useState(() => performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), TICK_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const status = thinkingStatus(call, elapsedMs, typicalMs);
  return (
    <div className="thinking">
      <span className="thinking__spark" aria-hidden="true">
        ✦
      </span>
      <div className="thinking__text">
        <span role="status">
          {status.title}
          <span className="thinking__dots" aria-hidden="true" />
        </span>
        <span className="thinking__meta" aria-hidden="true">
          {status.elapsed}
          {status.hint !== "" && ` · ${status.hint}`}
        </span>
      </div>
      <button type="button" className="btn btn--small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
