import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export function useSelfieSegmenter() {
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSegmenter() {
      try {
        setIsLoading(true);
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });

        if (!isMounted) {
          segmenter.close();
          return;
        }

        segmenterRef.current = segmenter;
        setError(null);
      } catch {
        if (isMounted) {
          setError("Selfie cutout could not load. Poster stickers may be less accurate.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSegmenter();

    return () => {
      isMounted = false;
      segmenterRef.current?.close();
      segmenterRef.current = null;
    };
  }, []);

  const createPersonMask = useCallback((source: HTMLCanvasElement) => {
    const segmenter = segmenterRef.current;
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
  }, []);

  return { createPersonMask, isLoading, error };
}
