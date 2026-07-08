import { useCallback, useEffect, useRef, useState } from "react";
import { PrinterPanel, type PrinterStatus } from "./components/PrinterPanel";
import { loadBoothAssets, type BoothAssets } from "./lib/assets";
import { CANVAS_SIZE, drawScene, drawStickerScene } from "./lib/drawScene";
import {
  getGestureLabel,
  mapGestureToState,
  type Effect,
  type GestureResult,
  type Pose,
} from "./lib/gestures";
import { useCamera } from "./lib/useCamera";
import { useGestureRecognizer } from "./lib/useGestureRecognizer";
import { useSelfieSegmenter } from "./lib/useSelfieSegmenter";
import {
  composePoster,
  downloadComposedPoster,
  type ComposedPosterResult,
} from "./lib/poster/composePoster";
import { createStickerCutout } from "./lib/poster/createStickerCutout";

type StableCandidate = {
  name: string;
  score: number;
  landmarks: GestureResult["landmarks"];
  count: number;
};

const INITIAL_POSE: Pose = "base";
const INITIAL_EFFECT: Effect = "none";
const SMOOTHING_FRAMES = 5;
const PRINT_DURATION_MS = 5000;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const assetsRef = useRef<BoothAssets | null>(null);
  const poseRef = useRef<Pose>(INITIAL_POSE);
  const effectRef = useRef<Effect>(INITIAL_EFFECT);
  const stableGestureRef = useRef<GestureResult | null>(null);
  const drawGestureRef = useRef<GestureResult | null>(null);
  const candidateRef = useRef<StableCandidate | null>(null);
  const poseChangedAtRef = useRef(0);
  const snapStartedAtRef = useRef<number | null>(null);
  const stickerCutoutRef = useRef<HTMLCanvasElement | null>(null);

  const [assetsReady, setAssetsReady] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>(INITIAL_POSE);
  const [effect, setEffect] = useState<Effect>(INITIAL_EFFECT);
  const [gesture, setGesture] = useState<GestureResult | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>("idle");
  const [printProgress, setPrintProgress] = useState(0);
  const [composedPoster, setComposedPoster] = useState<ComposedPosterResult | null>(null);

  const camera = useCamera();
  const {
    recognize,
    isLoading: isRecognizerLoading,
    error: recognizerError,
  } = useGestureRecognizer();
  const {
    createPersonMask,
    isLoading: isSegmenterLoading,
    error: segmenterError,
  } = useSelfieSegmenter();

  useEffect(() => {
    let isMounted = true;

    loadBoothAssets()
      .then((assets) => {
        if (!isMounted) {
          return;
        }
        assetsRef.current = assets;
        setAssetsReady(true);
      })
      .catch(() => {
        if (isMounted) {
          setAssetError("Some booth art could not load. Please check the PNG assets.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  useEffect(() => {
    effectRef.current = effect;
  }, [effect]);

  useEffect(() => {
    let frameId = 0;

    function updateSmoothedGesture(result: GestureResult | null) {
      if (!result) {
        candidateRef.current = null;
        return;
      }

      if (!result.recognized) {
        if (stableGestureRef.current) {
          stableGestureRef.current = {
            ...stableGestureRef.current,
            landmarks: result.landmarks,
          };
          drawGestureRef.current = stableGestureRef.current;
        } else if (result.landmarks) {
          drawGestureRef.current = result;
        }

        candidateRef.current = null;
        return;
      }

      if (stableGestureRef.current) {
        stableGestureRef.current = {
          ...stableGestureRef.current,
          landmarks: result.landmarks,
        };
        drawGestureRef.current = stableGestureRef.current;
      }

      if (candidateRef.current?.name === result.name) {
        candidateRef.current = {
          name: result.name,
          score: result.score,
          landmarks: result.landmarks,
          count: candidateRef.current.count + 1,
        };
      } else {
        candidateRef.current = {
          name: result.name,
          score: result.score,
          landmarks: result.landmarks,
          count: 1,
        };
      }

      if (candidateRef.current.count < SMOOTHING_FRAMES) {
        return;
      }

      const nextGesture = {
        name: candidateRef.current.name,
        score: candidateRef.current.score,
        landmarks: candidateRef.current.landmarks,
        recognized: true,
      };

      if (stableGestureRef.current?.name !== nextGesture.name) {
        stableGestureRef.current = nextGesture;
        drawGestureRef.current = nextGesture;
        setGesture(nextGesture);

        const nextState = mapGestureToState(nextGesture.name);
        if (nextState) {
          let changed = false;

          if (nextState.pose && poseRef.current !== nextState.pose) {
            poseRef.current = nextState.pose;
            setPose(nextState.pose);
            changed = true;
          }

          if (nextState.effect && effectRef.current !== nextState.effect) {
            effectRef.current = nextState.effect;
            setEffect(nextState.effect);
            changed = true;
          }

          if (changed) {
            poseChangedAtRef.current = performance.now();
          }
        }
      }
    }

    function render(time: number) {
      const assets = assetsRef.current;
      const canvas = canvasRef.current;
      const video = camera.videoRef.current;

      if (assets && canvas) {
        if (camera.isReady && video) {
          updateSmoothedGesture(recognize(video));
        }

        drawScene({
          canvas,
          video: camera.isReady ? video : null,
          assets,
          pose: poseRef.current,
          effect: effectRef.current,
          gesture: drawGestureRef.current,
          poseChangedAt: poseChangedAtRef.current,
          snapStartedAt: snapStartedAtRef.current,
          time,
        });
      }

      frameId = requestAnimationFrame(render);
    }

    frameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(frameId);
  }, [camera.isReady, camera.videoRef, recognize]);

  const handleSnap = useCallback(() => {
    const canvas = canvasRef.current;
    const assets = assetsRef.current;
    const video = camera.videoRef.current;
    if (!canvas) {
      return;
    }

    const capturedCanvas = document.createElement("canvas");
    capturedCanvas.width = canvas.width;
    capturedCanvas.height = canvas.height;
    const capturedCtx = capturedCanvas.getContext("2d");

    if (!capturedCtx) {
      setDownloadMessage("Could not capture the penguin photo. Please try again.");
      return;
    }

    capturedCtx.drawImage(canvas, 0, 0);

    const dataUrl = capturedCanvas.toDataURL("image/png");
    const personMask = createPersonMask(capturedCanvas);

    if (assets && video && video.videoWidth > 0 && video.videoHeight > 0 && personMask) {
      const stickerScene = document.createElement("canvas");
      stickerScene.width = CANVAS_SIZE;
      stickerScene.height = CANVAS_SIZE;

      drawStickerScene({
        canvas: stickerScene,
        video,
        personMask,
        assets,
        pose: poseRef.current,
        effect: effectRef.current,
        gesture: drawGestureRef.current,
        poseChangedAt: poseChangedAtRef.current,
        time: performance.now(),
      });

      stickerCutoutRef.current = createStickerCutout({
        source: stickerScene,
        outlineSize: CANVAS_SIZE * 0.018,
        padding: CANVAS_SIZE * 0.04,
        trimAlphaThreshold: 2,
        useSourceAlpha: true,
      });
    } else {
      stickerCutoutRef.current = createStickerCutout({
        source: capturedCanvas,
        mask: personMask ?? undefined,
        outlineSize: CANVAS_SIZE * 0.018,
        padding: CANVAS_SIZE * 0.04,
        removeCaptionBand: false,
        removeWatermark: false,
      });
    }

    setSnapshot(dataUrl);
    setComposedPoster(null);
    setPrintProgress(0);
    setPrinterStatus("captured");
    setDownloadMessage(null);
    snapStartedAtRef.current = performance.now();
  }, [camera.videoRef, createPersonMask]);

  const handleDownload = useCallback(async () => {
    if (!snapshot || !stickerCutoutRef.current) {
      setDownloadMessage("Snap a penguin photo first.");
      return;
    }

    try {
      setDownloadMessage(null);
      setComposedPoster(null);
      setPrintProgress(0);
      setPrinterStatus("generating");

      const poster = await composePoster({ stickerCutout: stickerCutoutRef.current });
      setComposedPoster(poster);
      setPrinterStatus("printing");

      const startedAt = performance.now();

      await new Promise<void>((resolve) => {
        function animate(now: number) {
          const elapsed = Math.min(1, (now - startedAt) / PRINT_DURATION_MS);
          const easedProgress = elapsed * elapsed * (3 - 2 * elapsed);
          const nextProgress = easedProgress * 100;
          setPrintProgress(nextProgress);

          if (nextProgress >= 100) {
            resolve();
            return;
          }

          requestAnimationFrame(animate);
        }

        requestAnimationFrame(animate);
      });

      setPrintProgress(100);
      setPrinterStatus("complete");
    } catch {
      setPrinterStatus("captured");
      setDownloadMessage("Could not print the poster. Please try again.");
    }
  }, [snapshot]);

  const handlePosterDownload = useCallback(() => {
    if (!composedPoster) {
      return;
    }

    downloadComposedPoster(composedPoster);
  }, [composedPoster]);

  const handleRetake = useCallback(() => {
    stickerCutoutRef.current = null;
    setSnapshot(null);
    setComposedPoster(null);
    setPrintProgress(0);
    setPrinterStatus("idle");
    setDownloadMessage(null);
  }, []);

  const isLoading = !assetsReady || isRecognizerLoading || isSegmenterLoading;
  const error = assetError ?? recognizerError ?? segmenterError ?? camera.error;
  const isPrinterBusy = printerStatus === "generating" || printerStatus === "printing";

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Cute camera magic</p>
        <h1>Penguin Photo Booth</h1>
        <p className="subtitle">Make a gesture. Get a penguin pose.</p>
      </section>

      <section className="booth-card" aria-label="Penguin Photo Booth camera">
        <div className="canvas-wrap">
          <canvas
            ref={canvasRef}
            className="booth-canvas"
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            aria-label="Penguin photo booth canvas"
          />
          <div key={gesture?.name ?? "ready"} className="gesture-pill">
            <span className="gesture-dot" />
            {getGestureLabel(gesture)}
          </div>
          {camera.isReady ? (
            <div className="booth-guide" aria-hidden="true">
              <div className="guide-tip">Tip: plain background + good lighting = cleaner poster ✨</div>
            </div>
          ) : null}
          {isLoading ? <div className="loading-badge">Loading MediaPipe...</div> : null}
        </div>

        <video ref={camera.videoRef} className="camera-video" playsInline muted />

        {error ? <p className="status-message error">{error}</p> : null}
        {downloadMessage ? <p className="status-message">{downloadMessage}</p> : null}

        <div className="gesture-guide" aria-label="Gesture guide">
          <span>✋ Wave</span>
          <span>✌️ Peace</span>
          <span>✊ Grumpy</span>
          <span>👍 Sparkle</span>
          <span>🤟 Love</span>
        </div>

        <div className="controls">
          <button type="button" onClick={camera.startCamera} disabled={isLoading}>
            Open Camera
          </button>
          <button type="button" onClick={handleSnap} disabled={!assetsReady || isPrinterBusy}>
            Take Cute Shot
          </button>
        </div>

        {snapshot ? (
          <section className="preview-panel" aria-label="Snapped penguin photo preview">
            <h2>Preview</h2>
            <img src={snapshot} alt="Snapped Penguin Photo Booth result" />
          </section>
        ) : null}

        <div className="controls print-controls">
          <button type="button" onClick={handleDownload} disabled={!snapshot || isPrinterBusy}>
            {snapshot ? "Print My Poster" : "Save Photo"}
          </button>
        </div>
      </section>

      <PrinterPanel
        status={printerStatus}
        progress={printProgress}
        posterDataURL={composedPoster?.dataURL ?? null}
        selectedPosterName={composedPoster?.selectedPosterName}
        onDownload={handlePosterDownload}
        onRetake={handleRetake}
      />
    </main>
  );
}
