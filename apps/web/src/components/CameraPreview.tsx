import { useEffect, useMemo, useRef, useState } from "react";
import { SkinCoverage } from "@look-studio/shared";
import type { LookSpec } from "@look-studio/shared";
import {
  listVideoDevices,
  mapGetUserMediaError,
  mediaDevicesAvailable,
  startCamera,
  statusMessage,
  stopStream,
} from "../tracking/camera.ts";
import type { CameraStatus, VideoDevice } from "../tracking/camera.ts";
import { useFaceTracker } from "../tracking/use-face-tracker.ts";
import type { TrackerReadout } from "../tracking/use-face-tracker.ts";
import { useLookScene } from "../scene/use-look-scene.ts";
import { wearableLayout } from "../scene/wearable-layout.ts";
import Window from "./Window.tsx";

export default function CameraPreview({ look, thinking }: { look: LookSpec | null; thinking: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mirror, setMirror] = useState(true);
  const [plain, setPlain] = useState(false);
  const [touchUp, setTouchUp] = useState(0);
  const [coverage, setCoverage] = useState<SkinCoverage>("none");
  const lookId = look?.id;
  const lookSkin = look?.makeup?.skin;
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("prompt");
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);

  useEffect(() => {
    void refreshDevices();
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sampleUrl !== null) {
      videoRef.current?.play().catch(() => {});
      return () => URL.revokeObjectURL(sampleUrl);
    }
  }, [sampleUrl]);

  useEffect(() => {
    if (lookSkin !== undefined) {
      setTouchUp(Math.round(lookSkin.smoothing * 100));
      setCoverage(lookSkin.coverage ?? "none");
    }
  }, [lookId, lookSkin]);

  const finish = lookSkin?.finish ?? "natural";
  const skin = useMemo(() => ({ smoothing: touchUp / 100, coverage, finish }), [touchUp, coverage, finish]);

  const refreshDevices = async () => {
    try {
      setDevices(await listVideoDevices());
    } catch {
      setDevices([]);
    }
  };

  const stop = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSampleUrl(null);
  };

  const enable = async () => {
    if (!mediaDevicesAvailable()) {
      setStatus("no-device");
      return;
    }
    stop();
    setStatus("requesting");
    try {
      const stream = await startCamera(deviceId === "" ? undefined : deviceId);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("live");
      await refreshDevices();
    } catch (error) {
      const failure = mapGetUserMediaError(error);
      setStatus(failure === "unknown" ? "error" : failure);
    }
  };

  const disable = () => {
    stop();
    setStatus("prompt");
  };

  const playSample = (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    stop();
    setSampleUrl(URL.createObjectURL(file));
    setStatus("sample");
  };

  const selectable = devices.filter((device) => device.deviceId !== "");

  const wearing = look?.wearables.filter((wearable) => wearable.visible !== false).map((wearable) => wearable.label) ?? [];
  const showing = status === "live" || status === "sample";
  const { headRef, readout } = useFaceTracker(videoRef, showing);
  const wearables = useMemo(() => wearableLayout(look), [look]);
  useLookScene({ canvasRef, videoRef, headRef }, showing, mirror, look?.makeup, plain, wearables, skin);

  return (
    <Window id="camera" title="LookCam Player 2000" icon="◉" flavor="blueberry" className="win--camera">
      <div className="player">
        <div className="player__screen">
          <video
            ref={videoRef}
            className="player__video--hidden"
            src={sampleUrl ?? undefined}
            muted
            playsInline
            loop
            aria-label="Camera source"
          />
          <canvas ref={canvasRef} className="player__output" hidden={!showing} aria-label="Look Studio output preview" />
          {!showing && (
            <div className="player__idle">
              <span className="player__idle-logo" aria-hidden="true">◉</span>
              <span>NO SIGNAL</span>
            </div>
          )}
          {thinking !== null && showing && (
            <div className="player__thinking" aria-hidden="true">
              <span className="player__thinking-spark">✦</span> {thinking}…
            </div>
          )}
          {look !== null && showing && !plain && (
            <div className="player__ticker" aria-hidden="true">
              <span>
                NOW WEARING: {look.name}
                {wearing.length > 0 && ` ✦ ${wearing.join(" ✦ ")}`}
              </span>
            </div>
          )}
        </div>
        <div className="player__lcd" role="status">
          <span className={`led ${status === "live" ? "led--on" : ""}`} aria-hidden="true" />
          {statusMessage(status)}
          {showing && <span className="player__track">{trackerText(readout)}</span>}
        </div>
        <div className="player__deck">
          {status === "live" ? (
            <>
              <button type="button" className="btn" onClick={() => void enable()}>
                ⟲ Restart
              </button>
              <button type="button" className="btn" onClick={disable}>
                ■ Stop
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--play" onClick={() => void enable()} disabled={status === "requesting"}>
              {status === "requesting" ? "Requesting…" : "▶ Start camera"}
            </button>
          )}
          <button type="button" className="btn" aria-pressed={mirror} onClick={() => setMirror((value) => !value)}>
            ⇋ Mirror
          </button>
          <button type="button" className="btn" aria-pressed={plain} onClick={() => setPlain((value) => !value)}>
            ◌ Plain camera
          </button>
          <label className="btn btn--file">
            Sample video
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(event) => {
                playSample(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="player__touchup">
          <label htmlFor="touch-up">✨ Touch-up</label>
          <input
            id="touch-up"
            type="range"
            min={0}
            max={100}
            step={5}
            value={touchUp}
            aria-valuetext={touchUp === 0 ? "off" : `${touchUp}%`}
            onChange={(event) => setTouchUp(Number(event.target.value))}
          />
          <output htmlFor="touch-up">{touchUp === 0 ? "off" : `${touchUp}%`}</output>
          <label htmlFor="coverage">Coverage</label>
          <select id="coverage" value={coverage} onChange={(event) => setCoverage(SkinCoverage.parse(event.target.value))}>
            {SkinCoverage.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="player__source">
          <label htmlFor="camera-device">Source</label>
          <select id="camera-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Default camera</option>
            {selectable.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--small" onClick={() => void refreshDevices()}>
            Refresh
          </button>
        </div>
      </div>
    </Window>
  );
}

function trackerText(readout: TrackerReadout): string {
  switch (readout.status) {
    case "loading":
      return "FACE: loading…";
    case "error":
      return "FACE: tracker offline";
    case "off":
      return "";
    case "tracking":
      return readout.confidence > 0
        ? `FACE ${Math.round(readout.confidence * 100)}% · ${readout.fps.toFixed(0)} FPS`
        : `NO FACE · ${readout.fps.toFixed(0)} FPS`;
  }
}
