import { describe, expect, it } from "vitest";
import { createFaceTracker } from "../src/tracking/face-tracker.ts";
import type { FrameScheduler, VideoFrameSource } from "../src/tracking/face-tracker.ts";
import { createFpsCounter, createHeadState, writeHeadState } from "../src/tracking/head-state.ts";
import type { FaceSample, HeadState } from "../src/tracking/head-state.ts";

function face(count: number, x = 0.5): FaceSample {
  return {
    faceLandmarks: [Array.from({ length: count }, (_, i) => ({ x, y: 0.5, z: i }))],
    facialTransformationMatrixes: [{ data: Array.from({ length: 16 }, (_, i) => i) }],
  };
}

function manualScheduler() {
  const queue = new Map<number, (t: number) => void>();
  let next = 1;
  const scheduler: FrameScheduler = {
    request(callback) {
      queue.set(next, callback);
      return next++;
    },
    cancel(handle) {
      queue.delete(handle);
    },
  };
  const flush = (t: number) => {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback(t));
  };
  return { scheduler, flush, pending: () => queue.size };
}

describe("writeHeadState", () => {
  it("reuses the same buffers across frames", () => {
    const state = createHeadState();
    const { landmarks, pose } = state;
    writeHeadState(state, face(478), 10);
    writeHeadState(state, face(478), 20);
    expect(state.landmarks).toBe(landmarks);
    expect(state.pose).toBe(pose);
    expect(state.landmarkCount).toBe(478);
    expect(state.landmarks[3 * 5 + 2]).toBe(5);
    expect(state.pose[15]).toBe(15);
    expect(state.timestampMs).toBe(20);
  });

  it("reports zero confidence when no face is found", () => {
    const state = writeHeadState(createHeadState(), { faceLandmarks: [] }, 5);
    expect(state.confidence).toBe(0);
    expect(state.landmarkCount).toBe(0);
  });

  it("lowers confidence for landmarks outside the frame", () => {
    const sample = face(4);
    const points = sample.faceLandmarks[0] ?? [];
    points.forEach((point, i) => {
      point.x = i < 1 ? 1.4 : 0.5;
    });
    expect(writeHeadState(createHeadState(), sample, 0).confidence).toBe(0.75);
  });

  it("caps landmark count at the buffer size", () => {
    expect(writeHeadState(createHeadState(), face(600), 0).landmarkCount).toBe(478);
  });
});

describe("createFpsCounter", () => {
  it("averages over the window", () => {
    const counter = createFpsCounter(5);
    [0, 40, 80, 120, 160, 200].forEach((t) => counter.tick(t));
    expect(counter.fps).toBeCloseTo(25);
  });

  it("returns zero until two ticks arrive", () => {
    expect(createFpsCounter().tick(100)).toBe(0);
  });
});

describe("createFaceTracker", () => {
  const setup = (overrides: { detect?: () => FaceSample; filter?: boolean } = {}) => {
    const video: VideoFrameSource = { currentTime: 0, readyState: 4 };
    const frames: { confidence: number; pose0: number; landmark0: number; fps: number }[] = [];
    const errors: unknown[] = [];
    const { scheduler, flush, pending } = manualScheduler();
    let clock = 0;
    let calls = 0;
    const tracker = createFaceTracker({
      video,
      scheduler,
      now: () => clock,
      detector: {
        detectForVideo: () => {
          calls += 1;
          return overrides.detect?.() ?? face(478);
        },
      },
      poseFilter:
        overrides.filter === true
          ? { filter: (sample: Float32Array) => sample.map((value) => value * 2) }
          : undefined,
      landmarkFilter:
        overrides.filter === true
          ? { filter: (sample: Float32Array) => sample.map((value) => value / 2) }
          : undefined,
      onFrame: (state: HeadState, fps: number) =>
        frames.push({ confidence: state.confidence, pose0: state.pose[1] ?? 0, landmark0: state.landmarks[0] ?? 0, fps }),
      onError: (error) => errors.push(error),
    });
    const advance = (t: number) => {
      clock = t;
      (video as { currentTime: number }).currentTime = t / 1000;
      flush(t);
    };
    return { tracker, video, frames, errors, flush, pending, advance, calls: () => calls };
  };

  it("emits a head state per new video frame", () => {
    const { tracker, frames, advance } = setup();
    tracker.start();
    advance(33);
    advance(66);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.confidence).toBe(1);
    expect(frames[1]?.fps).toBeCloseTo(1000 / 33);
  });

  it("skips frames when the video has not advanced", () => {
    const { tracker, frames, advance, flush, calls } = setup();
    tracker.start();
    advance(33);
    flush(40);
    expect(frames).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  it("waits until the video has data", () => {
    const { tracker, video, frames, advance } = setup();
    (video as { readyState: number }).readyState = 1;
    tracker.start();
    advance(33);
    expect(frames).toHaveLength(0);
  });

  it("applies the pose filter when a face is present", () => {
    const { tracker, frames, advance } = setup({ filter: true });
    tracker.start();
    advance(33);
    expect(frames[0]?.pose0).toBe(2);
  });

  it("applies the landmark filter only when a face is present", () => {
    const found = setup({ filter: true });
    found.tracker.start();
    found.advance(33);
    expect(found.frames[0]?.landmark0).toBeCloseTo(0.25);
    const lost = setup({ filter: true, detect: () => ({ faceLandmarks: [] }) });
    lost.tracker.start();
    lost.advance(33);
    expect(lost.frames[0]?.landmark0).toBe(0);
  });

  it("stops scheduling after stop", () => {
    const { tracker, pending, advance, frames } = setup();
    tracker.start();
    tracker.stop();
    expect(tracker.running).toBe(false);
    expect(pending()).toBe(0);
    advance(33);
    expect(frames).toHaveLength(0);
  });

  it("stops and reports when the detector throws", () => {
    const failure = new Error("gpu lost");
    const { tracker, errors, advance, pending } = setup({
      detect: () => {
        throw failure;
      },
    });
    tracker.start();
    advance(33);
    expect(errors).toEqual([failure]);
    expect(tracker.running).toBe(false);
    expect(pending()).toBe(0);
  });
});
