import { FaceLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { FaceDetector } from "./face-tracker.ts";
import type { LandmarkPoint } from "./head-state.ts";

export const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MODEL_TIMEOUT_MS = 20_000;

export class LandmarkerLoadError extends Error {
  override readonly name = "LandmarkerLoadError";
}

async function fetchModel(signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(FACE_MODEL_URL, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    throw new LandmarkerLoadError(`Face model download failed (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function createFaceLandmarker(signal: AbortSignal): Promise<FaceDetector<HTMLVideoElement> & { close(): void }> {
  const modelAssetBuffer = await fetchModel(signal);
  const landmarker = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetBuffer, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: true,
    },
  );
  if (signal.aborted) {
    landmarker.close();
    throw new LandmarkerLoadError("Face tracker setup was cancelled.");
  }
  return landmarker;
}

export async function detectFaceOnce(image: HTMLCanvasElement, signal: AbortSignal): Promise<LandmarkPoint[] | null> {
  const modelAssetBuffer = await fetchModel(signal);
  const landmarker = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    { baseOptions: { modelAssetBuffer, delegate: "CPU" }, runningMode: "IMAGE", numFaces: 1 },
  );
  try {
    return landmarker.detect(image).faceLandmarks[0] ?? null;
  } finally {
    landmarker.close();
  }
}
