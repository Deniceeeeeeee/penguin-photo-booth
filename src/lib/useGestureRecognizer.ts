import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { GestureResult } from "./gestures";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

let sharedRecognizer: GestureRecognizer | null = null;
let sharedRecognizerPromise: Promise<GestureRecognizer> | null = null;

async function loadSharedRecognizer() {
  if (sharedRecognizer) {
    return sharedRecognizer;
  }

  if (sharedRecognizerPromise) {
    return sharedRecognizerPromise;
  }

  sharedRecognizerPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      sharedRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
    } catch {
      sharedRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }

    return sharedRecognizer;
  })().catch((error) => {
    sharedRecognizerPromise = null;
    throw error;
  });

  return sharedRecognizerPromise;
}

export function useGestureRecognizer(enabled = true) {
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!enabled) {
      recognizerRef.current = null;
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    async function loadRecognizer() {
      try {
        setIsLoading(true);
        const recognizer = await loadSharedRecognizer();

        if (!isMounted) {
          return;
        }

        recognizerRef.current = recognizer;
        setError(null);
      } catch {
        if (isMounted) {
          setError("MediaPipe could not load. Please refresh and try again.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadRecognizer();

    return () => {
      isMounted = false;
      recognizerRef.current = null;
    };
  }, [enabled]);

  const recognize = useCallback((video: HTMLVideoElement): GestureResult | null => {
    const recognizer = recognizerRef.current;
    if (!recognizer || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const result = recognizer.recognizeForVideo(video, performance.now());
    const category = result.gestures[0]?.[0];

    return {
      name: category?.categoryName ?? "",
      score: category?.score ?? 0,
      landmarks: result.landmarks[0] ?? null,
      recognized: Boolean(category && category.score >= 0.55),
    };
  }, []);

  return { recognize, isLoading, error };
}
