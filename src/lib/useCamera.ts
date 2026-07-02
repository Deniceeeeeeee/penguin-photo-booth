import { useCallback, useEffect, useRef, useState } from "react";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support camera access.");
      return;
    }

    setError(null);

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        await videoRef.current.play();
        setIsReady(true);
      }
    } catch (cameraError) {
      stopCamera();
      const name = cameraError instanceof DOMException ? cameraError.name : "";
      setError(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Camera permission was denied. Please allow camera access to use the booth."
          : "We could not start the camera. Please check your camera and try again.",
      );
    }
  }, [stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  return { videoRef, isReady, startCamera, stopCamera, error };
}
