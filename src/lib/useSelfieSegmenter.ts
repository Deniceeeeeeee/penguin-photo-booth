import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

let sharedSegmenter: ImageSegmenter | null = null;
let sharedSegmenterPromise: Promise<ImageSegmenter | null> | null = null;

async function loadSharedSegmenter() {
  if (sharedSegmenter) {
    return sharedSegmenter;
  }

  if (sharedSegmenterPromise) {
    return sharedSegmenterPromise;
  }

  sharedSegmenterPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    sharedSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });

    return sharedSegmenter;
  })().catch(() => {
    sharedSegmenterPromise = null;
    return null;
  });

  return sharedSegmenterPromise;
}

export function useSelfieSegmenter() {
  const isMountedRef = useRef(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSegmenter = useCallback(async () => {
    try {
      if (!sharedSegmenter) {
        setIsLoading(true);
      }

      const segmenter = await loadSharedSegmenter();
      if (!segmenter) {
        setError("Selfie cutout could not load. Poster stickers may be less accurate.");
        return null;
      }

      setError(null);
      return segmenter;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const createPersonMask = useCallback(async (source: HTMLCanvasElement) => {
    const segmenter = await loadSegmenter();
    if (!segmenter) {
      return null;
    }

    const result = segmenter.segment(source);
    const confidenceMask = result.confidenceMasks?.[0];
    if (!confidenceMask) {
      return null;
    }

    const maskData = confidenceMask.getAsFloat32Array();
    const imageData = new ImageData(confidenceMask.width, confidenceMask.height);

    for (let index = 0; index < maskData.length; index += 1) {
      const alpha = Math.max(0, Math.min(255, Math.round(maskData[index] * 255)));
      imageData.data[index * 4] = 255;
      imageData.data[index * 4 + 1] = 255;
      imageData.data[index * 4 + 2] = 255;
      imageData.data[index * 4 + 3] = alpha;
    }

    return imageData;
  }, [loadSegmenter]);

  return { createPersonMask, isLoading, error };
}
