import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Grooming, Makeup } from "@look-studio/shared";
import type { HeadState } from "../tracking/head-state.ts";
import { createAvatarMotion, headAngles, stepAvatarMotion } from "./avatar-rig.ts";
import type { AvatarView } from "./avatar-view.ts";
import { MIN_CONFIDENCE, createFrameGate, createHeadAnchor, writeHeadAnchor } from "./head-anchor.ts";
import type { Viewport } from "./head-anchor.ts";
import { createLookScene } from "./look-scene.ts";
import type { WearableLayout } from "./wearable-layout.ts";
import type { LookScene } from "./look-scene.ts";
import { createMakeupPainter } from "./makeup-painter.ts";
import { createMakeupGeometry, writeMakeupGeometry } from "./makeup-regions.ts";
import { groomingShape, makeupPasses } from "./makeup-style.ts";
import { createHairPatterns } from "./hair-texture.ts";
import { NATURAL_SHAPE } from "./makeup-regions.ts";
import { NO_SKIN, createSkinSmoother } from "./skin-smoother.ts";
import type { SkinRender, SmoothLayer } from "./skin-smoother.ts";
import { WOBBLE_PARAMS, createWobble, stepWobble } from "./wobble.ts";
import type { MakeupPass } from "./makeup-style.ts";

const OUTPUT_FPS = 30;
const NO_PASSES: MakeupPass[] = [];

function createLayer(readable: boolean): SmoothLayer | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: readable });
  return ctx === null ? null : { canvas, ctx };
}

interface LookSceneRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  headRef: RefObject<HeadState | null>;
}

export function useLookScene(
  { canvasRef, videoRef, headRef }: LookSceneRefs,
  active: boolean,
  mirror: boolean,
  makeup: Makeup | undefined,
  grooming: Grooming | undefined,
  plain: boolean,
  wearables: WearableLayout,
  skin: SkinRender,
  wobbleOn: boolean,
  avatar: AvatarView | null,
) {
  const sceneRef = useRef<LookScene | null>(null);
  const viewRef = useRef<Viewport>({ width: 0, height: 0, mirror });
  const passesRef = useRef<MakeupPass[]>([]);
  const shapeRef = useRef(NATURAL_SHAPE);
  const plainRef = useRef(plain);
  plainRef.current = plain;
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const wobbleOnRef = useRef(wobbleOn);
  wobbleOnRef.current = wobbleOn;
  const wearablesRef = useRef(wearables);
  const avatarRef = useRef(avatar);

  useEffect(() => {
    avatarRef.current = avatar;
    sceneRef.current?.setAvatar(avatar);
  }, [avatar]);

  useEffect(() => {
    wearablesRef.current = wearables;
    sceneRef.current?.setWearables(wearables);
  }, [wearables]);

  useEffect(() => {
    passesRef.current = makeupPasses(makeup, grooming);
    shapeRef.current = groomingShape(grooming);
  }, [makeup, grooming]);

  useEffect(() => {
    viewRef.current.mirror = mirror;
    sceneRef.current?.setMirror(mirror);
  }, [mirror]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const backdrop = document.createElement("canvas");
    const context = backdrop.getContext("2d");
    if (!active || canvas === null || video === null || context === null) {
      return;
    }
    const hair = createHairPatterns(context, () => createLayer(false));
    const painter = createMakeupPainter(context, createSkinSmoother(createLayer), hair);
    const geometry = createMakeupGeometry();
    const scene = createLookScene(canvas, backdrop);
    sceneRef.current = scene;
    scene.setMirror(viewRef.current.mirror);
    scene.setWearables(wearablesRef.current);
    scene.setAvatar(avatarRef.current);
    const anchor = createHeadAnchor();
    const gate = createFrameGate(OUTPUT_FPS);
    const view = viewRef.current;
    const wobble = createWobble();
    const motion = createAvatarMotion();
    const angles = { yaw: 0, pitch: 0, roll: 0 };
    let lastMs = Number.NaN;
    let handle = 0;

    const frame = (tMs: number) => {
      handle = requestAnimationFrame(frame);
      if (!gate(tMs) || video.videoWidth === 0) {
        return;
      }
      if (video.videoWidth !== view.width || video.videoHeight !== view.height) {
        view.width = video.videoWidth;
        view.height = video.videoHeight;
        backdrop.width = view.width;
        backdrop.height = view.height;
        scene.resize(view.width, view.height);
      }
      const head = headRef.current;
      const avatarFrame = avatarRef.current;
      if (avatarFrame !== null) {
        const tracked = head !== null && head.confidence >= MIN_CONFIDENCE;
        stepAvatarMotion(motion, tracked ? headAngles(angles, head.pose, view.mirror) : null, (tMs - lastMs) / 1000);
        lastMs = tMs;
        avatarFrame.pose(motion, tMs / 1000);
        scene.render(anchor, wobble);
        return;
      }
      const plainFrame = plainRef.current;
      const passes = plainFrame ? NO_PASSES : passesRef.current;
      const skinFrame = plainFrame ? NO_SKIN : skinRef.current;
      painter.paint(video, writeMakeupGeometry(geometry, head, view.width, view.height, shapeRef.current), passes, view.width, view.height, skinFrame);
      writeHeadAnchor(anchor, head, view);
      anchor.visible = anchor.visible && !plainRef.current;
      const headProp = wearablesRef.current.head;
      const params = wobbleOnRef.current && headProp !== null ? WOBBLE_PARAMS[headProp.template] : null;
      stepWobble(wobble, anchor, (tMs - lastMs) / 1000, params);
      lastMs = tMs;
      scene.render(anchor, wobble);
    };
    handle = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(handle);
      scene.dispose();
      sceneRef.current = null;
      view.width = 0;
      view.height = 0;
    };
  }, [canvasRef, videoRef, headRef, active]);
}
