import { useCallback, useEffect, useReducer, useRef } from "react";
import type { LookSpec } from "@look-studio/shared";
import { errorMessage, requestEdit, streamLook } from "./api-client.ts";
import { composePrompt, contextNote } from "./prompt-compose.ts";
import type { LookContext } from "./prompt-compose.ts";
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
  send: (text: string, photo: OutgoingPhoto | null, context: LookContext) => Promise<void>;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  wear: (look: LookSpec, name: string) => void;
  cancel: () => void;
} {
  const [state, dispatch] = useReducer(studioReducer, undefined, () => initialStudioState(clockTime()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const send = useCallback(async (text: string, photo: OutgoingPhoto | null, context: LookContext) => {
    const current = stateRef.current;
    if (current.pending) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const call = nextCall(current, photo !== null);
    const note = call === "look" ? contextNote(context) : undefined;
    dispatch({
      type: "sent",
      at: clockTime(),
      call,
      text,
      ...(photo === null ? {} : { attachment: photo.name }),
      ...(note === undefined ? {} : { note }),
    });
    if (call === "edit" && current.look !== null) {
      const result = await requestEdit({ utterance: text, look: current.look }, { signal: controller.signal });
      dispatch(
        result.ok
          ? { type: "edit-received", at: clockTime(), edits: result.data, meta: result.meta }
          : { type: "failed", at: clockTime(), call, error: result.error, message: errorMessage(result.error, result.retryAfterS) },
      );
      return;
    }
    const result = await streamLook(
      { chat: composePrompt(text, context), ...(photo === null ? {} : { image: photo.dataUrl }) },
      { signal: controller.signal, onText: (chunk) => dispatch({ type: "streamed", text: chunk }) },
    );
    dispatch(
      result.ok
        ? { type: "look-received", at: clockTime(), look: result.data, meta: result.meta }
        : { type: "failed", at: clockTime(), call, error: result.error, message: errorMessage(result.error, result.retryAfterS) },
    );
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => dispatch({ type: "reset", at: clockTime() }), []);
  const undo = useCallback(() => dispatch({ type: "undo", at: clockTime() }), []);
  const redo = useCallback(() => dispatch({ type: "redo", at: clockTime() }), []);

  const wear = useCallback(
    (look: LookSpec, name: string) => dispatch({ type: "look-loaded", at: clockTime(), look, name }),
    [],
  );

  return { state, send, reset, undo, redo, wear, cancel };
}
