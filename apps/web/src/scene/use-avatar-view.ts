import { useEffect, useState } from "react";
import { loadAvatarView } from "./avatar-view.ts";
import type { AvatarView } from "./avatar-view.ts";

export type AvatarViewState = { status: "none" } | { status: "loading" } | { status: "ready"; view: AvatarView } | { status: "error" };

export function useAvatarView(model: ArrayBuffer | null): AvatarViewState {
  const [state, setState] = useState<AvatarViewState>({ status: "none" });

  useEffect(() => {
    if (model === null) {
      setState({ status: "none" });
      return;
    }
    let cancelled = false;
    let loaded: AvatarView | null = null;
    setState({ status: "loading" });
    loadAvatarView(model).then(
      (view) => {
        if (cancelled) {
          view.dispose();
          return;
        }
        loaded = view;
        setState({ status: "ready", view });
      },
      () => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      },
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [model]);

  return state;
}
