import { useEffect, useState } from "react";
import { requestAvatarCheck } from "../studio/avatar-client.ts";
import { loadFailureMessage } from "../studio/avatar-flow.ts";
import { setupAvatarFace } from "./avatar-face-setup.ts";
import { logEvent } from "../studio/logger.ts";
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
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const bytes = model.byteLength;
    loadAvatarView(model).then(
      (view) => {
        if (cancelled) {
          view.dispose();
          return;
        }
        loaded = view;
        logEvent({ event: "avatar_load", durationMs: elapsed(), bytes, meshes: view.meshCount, bones: view.boneCount, outcome: "ok" });
        view.onFirstFrame(() => logEvent({ event: "avatar_first_frame", sinceModelMs: elapsed() }));
        setState({ status: "ready", view, warning: null });
        const setupStartedAt = performance.now();
        let checkRan = false;
        const logSetup = (outcome: string) =>
          logEvent({ event: "avatar_face_setup", durationMs: Math.round(performance.now() - setupStartedAt), checkRan, outcome });
        const check = (renders: { front: string; side: string }, signal: AbortSignal) => {
          checkRan = true;
          return requestAvatarCheck(renders, { signal }).then((result) => (result.ok ? result.check : null));
        };
        setupAvatarFace(view, check, controller.signal).then(
          (warning) => {
            logSetup(warning === null ? "ok" : "warning");
            if (!cancelled) {
              setState({ status: "ready", view, warning });
            }
          },
          (error: unknown) => {
            logSetup(error instanceof Error ? error.message.slice(0, 200) : "error");
            if (!cancelled) {
              setState({ status: "ready", view, warning: "Facial expressions couldn't be set up for this avatar." });
            }
          },
        );
      },
      (error: unknown) => {
        logEvent({ event: "avatar_load", durationMs: elapsed(), bytes, outcome: "error", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
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
