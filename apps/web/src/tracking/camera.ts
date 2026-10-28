export type CameraStatus =
  | "prompt"
  | "requesting"
  | "live"
  | "denied"
  | "no-device"
  | "in-use"
  | "sample"
  | "error";

export type CameraFailure = "denied" | "no-device" | "in-use" | "unknown";

export interface VideoDevice {
  deviceId: string;
  label: string;
}

interface RawDevice {
  kind: string;
  label: string;
  deviceId: string;
}

export function filterVideoDevices(devices: RawDevice[]): VideoDevice[] {
  return devices
    .filter((device) => device.kind === "videoinput" && !device.label.includes("OBS Virtual Camera"))
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label === "" ? `Camera ${index + 1}` : device.label,
    }));
}

export function mapGetUserMediaError(error: unknown): CameraFailure {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "in-use";
  }
  return "unknown";
}

export function statusMessage(status: CameraStatus): string {
  switch (status) {
    case "prompt":
      return "Camera is off. Choose a device and select Enable camera.";
    case "requesting":
      return "Requesting camera access…";
    case "live":
      return "Camera is live.";
    case "denied":
      return "Camera permission was denied. Allow camera access in the browser, then try again.";
    case "no-device":
      return "No camera device was found. Connect a camera or try the sample video.";
    case "in-use":
      return "The camera is in use by another app. Close it and try again.";
    case "sample":
      return "Playing the sample video file.";
    case "error":
      return "Could not start the camera.";
  }
}

export function mediaDevicesAvailable(): boolean {
  return "mediaDevices" in navigator && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export async function listVideoDevices(): Promise<VideoDevice[]> {
  if (!mediaDevicesAvailable()) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return filterVideoDevices(devices);
}

export async function startCamera(deviceId?: string): Promise<MediaStream> {
  const video = deviceId === undefined ? true : { deviceId: { exact: deviceId } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
