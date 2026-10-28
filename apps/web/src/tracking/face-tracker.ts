import type { PoseFilter } from "@look-studio/shared";
import { createFpsCounter, createHeadState, writeHeadState } from "./head-state.ts";
import type { FaceSample, HeadState } from "./head-state.ts";

export interface FaceDetector<V> {
  detectForVideo(video: V, timestampMs: number): FaceSample;
}

export interface VideoFrameSource {
  readonly currentTime: number;
  readonly readyState: number;
}

export interface FrameScheduler {
  request(callback: (tMs: number) => void): number;
  cancel(handle: number): void;
}

export interface FaceTrackerOptions<V extends VideoFrameSource> {
  detector: FaceDetector<V>;
  video: V;
  onFrame: (state: HeadState, fps: number) => void;
  onError?: (error: unknown) => void;
  poseFilter?: PoseFilter<Float32Array>;
  scheduler?: FrameScheduler;
  now?: () => number;
}

export interface FaceTracker {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

const HAVE_CURRENT_DATA = 2;

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export function createFaceTracker<V extends VideoFrameSource>(options: FaceTrackerOptions<V>): FaceTracker {
  const scheduler = options.scheduler ?? browserScheduler;
  const now = options.now ?? (() => performance.now());
  const state = createHeadState();
  const fps = createFpsCounter();
  let handle: number | null = null;
  let lastVideoTime = -1;

  const step = () => {
    handle = scheduler.request(step);
    const { video } = options;
    if (video.readyState < HAVE_CURRENT_DATA || video.currentTime === lastVideoTime) {
      return;
    }
    lastVideoTime = video.currentTime;
    const t = now();
    try {
      writeHeadState(state, options.detector.detectForVideo(video, t), t);
    } catch (error) {
      stop();
      options.onError?.(error);
      return;
    }
    if (state.confidence > 0 && options.poseFilter !== undefined) {
      state.pose.set(options.poseFilter.filter(state.pose, t));
    }
    options.onFrame(state, fps.tick(t));
  };

  const stop = () => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
    lastVideoTime = -1;
  };

  return {
    start() {
      if (handle === null) {
        handle = scheduler.request(step);
      }
    },
    stop,
    get running() {
      return handle !== null;
    },
  };
}
