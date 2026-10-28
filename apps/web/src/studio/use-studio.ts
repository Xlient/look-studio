import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage, requestEdit, requestLook } from "./api-client.ts";
import { initialStudioState, nextCall, studioReducer } from "./studio-state.ts";
import type { StudioState } from "./studio-state.ts";

export interface OutgoingPhoto {
  name: string;
  dataUrl: string;
}

export function clockTime(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function useStudio(): {
  state: StudioState;
  send: (text: string, photo: OutgoingPhoto | null) => Promise<void>;
  reset: () => void;
} {
  const [state, dispatch] = useReducer(studioReducer, undefined, () => initialStudioState(clockTime()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const send = useCallback(async (text: string, photo: OutgoingPhoto | null) => {
    const current = stateRef.current;
    if (current.pending) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const call = nextCall(current, photo !== null);
    dispatch({ type: "sent", at: clockTime(), text, ...(photo === null ? {} : { attachment: photo.name }) });
    if (call === "edit" && current.look !== null) {
      const result = await requestEdit({ utterance: text, look: current.look }, { signal: controller.signal });
      dispatch(
        result.ok
          ? { type: "edit-received", at: clockTime(), command: result.data, meta: result.meta }
          : { type: "failed", at: clockTime(), call, error: result.error, message: errorMessage(result.error, result.retryAfterS) },
      );
      return;
    }
    const result = await requestLook(
      { chat: text, ...(photo === null ? {} : { image: photo.dataUrl }) },
      { signal: controller.signal },
    );
    dispatch(
      result.ok
        ? { type: "look-received", at: clockTime(), look: result.data, meta: result.meta }
        : { type: "failed", at: clockTime(), call, error: result.error, message: errorMessage(result.error, result.retryAfterS) },
    );
  }, []);

  const reset = useCallback(() => dispatch({ type: "reset", at: clockTime() }), []);

  return { state, send, reset };
}
