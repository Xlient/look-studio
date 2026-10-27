import { useEffect, useRef, useState } from "react";

type CameraState = "idle" | "requesting" | "granted" | "denied" | "unavailable" | "error";

export default function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const enable = async () => {
    if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
      setState("unavailable");
      setMessage("Camera is unavailable here (needs HTTPS or localhost plus a camera device).");
      return;
    }
    setState("requesting");
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState("granted");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
        setMessage("Camera permission was denied. Allow camera access in the browser, then try again.");
      } else {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Could not start the camera.");
      }
    }
  };

  const disable = () => {
    stop();
    setState("idle");
    setMessage("");
  };

  return (
    <section className="card" aria-label="Camera preview">
      <h2>Camera preview</h2>
      <div className="video-wrap">
        <video ref={videoRef} muted playsInline />
        {state !== "granted" && <div className="video-fallback">Camera off</div>}
      </div>
      {message !== "" && <p className="notice">{message}</p>}
      <div className="row">
        {state === "granted" ? (
          <button type="button" onClick={disable}>
            Turn off camera
          </button>
        ) : (
          <button type="button" onClick={enable} disabled={state === "requesting"}>
            {state === "requesting" ? "Requesting…" : "Enable camera"}
          </button>
        )}
        <span className="status">Status: {state}</span>
      </div>
    </section>
  );
}
