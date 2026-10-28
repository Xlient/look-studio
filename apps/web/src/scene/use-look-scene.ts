import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { HeadState } from "../tracking/head-state.ts";
import { createFrameGate, createHeadAnchor, writeHeadAnchor } from "./head-anchor.ts";
import type { Viewport } from "./head-anchor.ts";
import { createLookScene } from "./look-scene.ts";
import type { LookScene } from "./look-scene.ts";

const OUTPUT_FPS = 30;

interface LookSceneRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  headRef: RefObject<HeadState | null>;
}

export function useLookScene({ canvasRef, videoRef, headRef }: LookSceneRefs, active: boolean, mirror: boolean) {
  const sceneRef = useRef<LookScene | null>(null);
  const viewRef = useRef<Viewport>({ width: 0, height: 0, mirror });

  useEffect(() => {
    viewRef.current.mirror = mirror;
    sceneRef.current?.setMirror(mirror);
  }, [mirror]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!active || canvas === null || video === null) {
      return;
    }
    const scene = createLookScene(canvas, video);
    sceneRef.current = scene;
    scene.setMirror(viewRef.current.mirror);
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
        scene.resize(view.width, view.height);
      }
      scene.render(writeHeadAnchor(anchor, headRef.current, view));
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
