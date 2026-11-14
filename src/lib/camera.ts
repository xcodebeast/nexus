/** Bound capture work and share one camera payload budget across the mesh. */
export const cameraVideoConstraints: MediaTrackConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 360, max: 360 },
  frameRate: { ideal: 15, max: 15 },
  facingMode: "user",
};

export const cameraTotalBitrate = 600_000;
const cameraPeerBitrate = 300_000;

export function getCameraEncoding(
  viewerCount: number,
): RTCRtpEncodingParameters {
  const maxBitrate = Math.floor(
    Math.min(cameraPeerBitrate, cameraTotalBitrate / Math.max(1, viewerCount)),
  );

  return {
    maxBitrate,
    maxFramerate: 15,
    scaleResolutionDownBy: maxBitrate < 200_000 ? 2 : 1,
    priority: "low",
  };
}

export function getCameraErrorMessage(cause: unknown) {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
      return "Camera access was denied. Allow it in your browser and try again.";
    }
    if (cause.name === "NotFoundError") {
      return "No camera is available. Connect one and try again.";
    }
    if (cause.name === "NotReadableError") {
      return "Camera is unavailable. Close other apps using it and try again.";
    }
  }

  return "Camera could not start. Try again.";
}
