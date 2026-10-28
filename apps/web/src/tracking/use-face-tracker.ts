import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createFaceTracker } from "./face-tracker.ts";
import type { HeadState } from "./head-state.ts";
import { createFaceLandmarker } from "./landmarker.ts";

export type TrackerStatus = "off" | "loading" | "tracking" | "error";

export interface TrackerReadout {
  status: TrackerStatus;
  fps: number;
  confidence: number;
}

const READOUT_INTERVAL_MS = 250;

export function useFaceTracker(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const headRef = useRef<HeadState | null>(null);
  const [readout, setReadout] = useState<TrackerReadout>({ status: "off", fps: 0, confidence: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (!active || video === null) {
      setReadout({ status: "off", fps: 0, confidence: 0 });
      return;
    }
    const controller = new AbortController();
    let stopTracker = () => {};
    let lastReadout = 0;
    setReadout({ status: "loading", fps: 0, confidence: 0 });

    createFaceLandmarker(controller.signal)
      .then((detector) => {
        const tracker = createFaceTracker({
          detector,
          video,
          onFrame: (state, fps) => {
            headRef.current = state;
            if (state.timestampMs - lastReadout >= READOUT_INTERVAL_MS) {
              lastReadout = state.timestampMs;
              setReadout({ status: "tracking", fps, confidence: state.confidence });
            }
          },
          onError: () => setReadout({ status: "error", fps: 0, confidence: 0 }),
        });
        tracker.start();
        stopTracker = () => {
          tracker.stop();
          detector.close();
        };
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReadout({ status: "error", fps: 0, confidence: 0 });
        }
      });

    return () => {
      controller.abort();
      stopTracker();
      headRef.current = null;
    };
  }, [videoRef, active]);

  return { headRef, readout };
}
