import { OrthographicCamera, WebGLRenderer } from "three";
import type { AvatarCheck } from "@look-studio/shared";
import { detectFaceOnce } from "../tracking/landmarker.ts";
import { GUESSED_FACE, anchorsFromEstimate, anchorsFromLandmarks } from "./avatar-face-anchors.ts";
import type { CaptureFrame, FaceAnchors, RgbaImage } from "./avatar-face-anchors.ts";
import { headBounds, installFaceRig, readHeadSurface } from "./avatar-face-rig.ts";
import type { HeadSurface } from "./avatar-face-rig.ts";
import type { FaceLayerMode } from "./avatar-face-layer.ts";
import type { AvatarView } from "./avatar-view.ts";

const CAPTURE_SIZE = 640;
const CHECK_SIZE = 384;
const CAPTURE_MARGIN = 1.1;
const JPEG_QUALITY = 0.8;
const FALLBACK_SKIN = [240, 205, 180] as const;

export type CheckAvatar = (renders: { front: string; side: string }, signal: AbortSignal) => Promise<AvatarCheck | null>;

interface Capture {
  frame: CaptureFrame;
  canvas: HTMLCanvasElement;
  image: RgbaImage;
  front: string;
  side: string;
}

// A temporary renderer, because the live one draws at the camera's aspect and must not stall on readbacks.
function captureViews(view: AvatarView, surface: HeadSurface): Capture | null {
  const bounds = headBounds(surface);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CAPTURE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (bounds === null || ctx === null) {
    return null;
  }
  const frame: CaptureFrame = {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    size: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * CAPTURE_MARGIN,
  };
  const half = frame.size / 2;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.01, frame.size * 8);
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false);
    const encode = (size: number) => {
      const small = document.createElement("canvas");
      small.width = small.height = size;
      small.getContext("2d")?.drawImage(renderer.domElement, 0, 0, size, size);
      return small.toDataURL("image/jpeg", JPEG_QUALITY);
    };
    camera.position.set(frame.centerX, frame.centerY, frame.size * 4);
    camera.lookAt(frame.centerX, frame.centerY, 0);
    renderer.render(view.scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);
    const front = encode(CHECK_SIZE);
    camera.position.set(frame.centerX + frame.size * 4, frame.centerY, 0);
    camera.lookAt(frame.centerX, frame.centerY, 0);
    renderer.render(view.scene, camera);
    const side = encode(CHECK_SIZE);
    const { data, width, height } = ctx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
    return { frame, canvas, image: { data, width, height }, front, side };
  } finally {
    renderer.dispose();
  }
}

export function warningFromCheck(check: AvatarCheck | null, located: boolean): string | null {
  if (check !== null && !check.usable) {
    return check.issue === "" ? "This avatar may not work well on calls." : check.issue;
  }
  return located ? null : "This character's face couldn't be tracked, so it has a simple drawn face.";
}

function drawnAnchors(check: AvatarCheck | null, frame: CaptureFrame): FaceAnchors {
  const estimate =
    check !== null && check.faceFound
      ? {
          leftEye: { x: check.leftEyeX, y: check.leftEyeY },
          rightEye: { x: check.rightEyeX, y: check.rightEyeY },
          mouth: { x: check.mouthX, y: check.mouthY },
        }
      : GUESSED_FACE;
  return anchorsFromEstimate(estimate, frame, FALLBACK_SKIN);
}

// Expressions are an extra: any failure leaves the avatar turning its head with its painted face.
export async function setupAvatarFace(view: AvatarView, checkAvatar: CheckAvatar, signal: AbortSignal): Promise<string | null> {
  const surface = view.head === null ? null : readHeadSurface(view.model, view.head);
  const capture = surface === null ? null : captureViews(view, surface);
  if (surface === null || capture === null || view.head === null) {
    return null;
  }
  const install = (anchors: FaceAnchors, mode: FaceLayerMode) => {
    if (view.head !== null && !signal.aborted) {
      view.setFaceRig(installFaceRig(surface, view.head, anchors, mode));
    }
  };
  const landmarks = await detectFaceOnce(capture.canvas, signal).catch(() => null);
  if (landmarks !== null) {
    install(anchorsFromLandmarks(landmarks, capture.image, capture.frame), "overlay");
  }
  const check = await checkAvatar({ front: capture.front, side: capture.side }, signal).catch(() => null);
  if (landmarks === null) {
    install(drawnAnchors(check, capture.frame), "drawn");
  }
  return warningFromCheck(check, landmarks !== null);
}
