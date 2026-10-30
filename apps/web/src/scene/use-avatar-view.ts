import { useEffect, useState } from "react";
import { requestAvatarCheck } from "../studio/avatar-client.ts";
import { loadFailureMessage } from "../studio/avatar-flow.ts";
import { setupAvatarFace } from "./avatar-face-setup.ts";
import { loadAvatarView } from "./avatar-view.ts";
import type { AvatarView } from "./avatar-view.ts";

export type AvatarViewState = { status: "none" } | { status: "loading" } | { status: "ready"; view: AvatarView; warning: string | null } | { status: "error"; message: string; retry: () => void };

export function useAvatarView(model: ArrayBuffer | null): AvatarViewState {
  const [state, setState] = useState<AvatarViewState>({ status: "none" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (model === null) {
      setState({ status: "none" });
      return;
    }
    let cancelled = false;
    let loaded: AvatarView | null = null;
    const controller = new AbortController();
    setState({ status: "loading" });
    loadAvatarView(model).then(
      (view) => {
        if (cancelled) {
          view.dispose();
          return;
        }
        loaded = view;
        setState({ status: "ready", view, warning: null });
        const check = (renders: { front: string; side: string }, signal: AbortSignal) =>
          requestAvatarCheck(renders, { signal }).then((result) => (result.ok ? result.check : null));
        setupAvatarFace(view, check, controller.signal).then(
          (warning) => {
            if (!cancelled) {
              setState({ status: "ready", view, warning });
            }
          },
          () => {
            if (!cancelled) {
              setState({ status: "ready", view, warning: "Facial expressions couldn't be set up for this avatar." });
            }
          },
        );
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: loadFailureMessage(error), retry: () => setAttempt((count) => count + 1) });
        }
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
      loaded?.dispose();
    };
  }, [model, attempt]);

  return state;
}
