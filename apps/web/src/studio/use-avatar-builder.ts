import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "./api-client.ts";
import type { ApiFailure } from "./api-client.ts";
import { abortableSleep, downloadAvatarModel, pollAvatarJob, requestConcepts, startAvatar } from "./avatar-client.ts";
import { INITIAL_FLOW, avatarFlowReducer, failureText } from "./avatar-flow.ts";
import type { AvatarFlow } from "./avatar-flow.ts";

export interface AvatarBuilder {
  flow: AvatarFlow;
  draw: (description: string, photo: string | undefined) => void;
  pick: (conceptId: string) => void;
  back: () => void;
  build: () => void;
  retryDownload: () => void;
  stop: () => void;
}

export function useAvatarBuilder(onModel: (model: ArrayBuffer) => void): AvatarBuilder {
  const [flow, dispatch] = useReducer(avatarFlowReducer, INITIAL_FLOW);
  const controllerRef = useRef<AbortController | null>(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const begin = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller.signal;
  };

  const failed = (signal: AbortSignal, failure: ApiFailure) => {
    if (!signal.aborted) {
      dispatch({ type: "fail", message: errorMessage(failure.error, failure.retryAfterS) });
    }
  };

  const download = async (jobId: string, signal: AbortSignal) => {
    const downloaded = await downloadAvatarModel(jobId, { signal });
    if (signal.aborted) {
      return;
    }
    if (downloaded.ok) {
      onModel(downloaded.model);
      dispatch({ type: "loaded" });
    } else {
      dispatch({ type: "download-failed", message: failureText(errorMessage(downloaded.error, downloaded.retryAfterS), downloaded.detail) });
    }
  };

  const draw = useCallback((description: string, photo: string | undefined) => {
    const signal = begin();
    dispatch({ type: "draw" });
    void requestConcepts(photo === undefined ? { description } : { description, photo }, { signal }).then((result) =>
      result.ok ? dispatch({ type: "concepts", concepts: result.concepts }) : failed(signal, result),
    );
  }, []);

  const build = useCallback(() => {
    const current = flowRef.current;
    if (current.step !== "confirm") {
      return;
    }
    const signal = begin();
    dispatch({ type: "build" });
    void (async () => {
      const started = await startAvatar(current.concept.id, { signal });
      if (!started.ok) {
        failed(signal, started);
        return;
      }
      dispatch({ type: "started", jobId: started.jobId });
      const polled = await pollAvatarJob(started.jobId, {
        signal,
        sleep: abortableSleep,
        now: () => Date.now(),
        onStatus: (status) => dispatch({ type: "status", status }),
      });
      if (!polled.ok) {
        failed(signal, polled);
        return;
      }
      await download(started.jobId, signal);
    })();
  }, [onModel]);

  const retryDownload = useCallback(() => {
    const current = flowRef.current;
    if (current.step !== "download-failed") {
      return;
    }
    const signal = begin();
    dispatch({ type: "retry-download" });
    void download(current.jobId, signal);
  }, [onModel]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return {
    flow,
    draw,
    pick: useCallback((conceptId: string) => dispatch({ type: "pick", conceptId }), []),
    back: useCallback(() => dispatch({ type: "back" }), []),
    build,
    retryDownload,
    stop,
  };
}
