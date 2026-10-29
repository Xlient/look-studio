import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Makeup } from "@look-studio/shared";
import type { HeadState } from "../tracking/head-state.ts";
import { createFrameGate, createHeadAnchor, writeHeadAnchor } from "./head-anchor.ts";
import type { Viewport } from "./head-anchor.ts";
import { createLookScene } from "./look-scene.ts";
import type { WearableLayout } from "./wearable-layout.ts";
import type { LookScene } from "./look-scene.ts";
import { createMakeupPainter } from "./makeup-painter.ts";
import { createMakeupGeometry, writeMakeupGeometry } from "./makeup-regions.ts";
import { makeupPasses } from "./makeup-style.ts";
import type { MakeupPass } from "./makeup-style.ts";

const OUTPUT_FPS = 30;
const NO_PASSES: MakeupPass[] = [];

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
  plain: boolean,
  wearables: WearableLayout,
) {
  const sceneRef = useRef<LookScene | null>(null);
  const viewRef = useRef<Viewport>({ width: 0, height: 0, mirror });
  const passesRef = useRef<MakeupPass[]>([]);
  const plainRef = useRef(plain);
  plainRef.current = plain;
  const wearablesRef = useRef(wearables);

  useEffect(() => {
    wearablesRef.current = wearables;
    sceneRef.current?.setWearables(wearables);
  }, [wearables]);

  useEffect(() => {
    passesRef.current = makeupPasses(makeup);
  }, [makeup]);

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
    const painter = createMakeupPainter(context);
    const geometry = createMakeupGeometry();
    const scene = createLookScene(canvas, backdrop);
    sceneRef.current = scene;
    scene.setMirror(viewRef.current.mirror);
    scene.setWearables(wearablesRef.current);
    const anchor = createHeadAnchor();
    const gate = createFrameGate(OUTPUT_FPS);
    const view = viewRef.current;
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
      const passes = plainRef.current ? NO_PASSES : passesRef.current;
      painter.paint(video, writeMakeupGeometry(geometry, head, view.width, view.height), passes, view.width, view.height);
      writeHeadAnchor(anchor, head, view);
      anchor.visible = anchor.visible && !plainRef.current;
      scene.render(anchor);
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
