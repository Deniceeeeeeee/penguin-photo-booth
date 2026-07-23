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
import {
  loadNftPenguin,
  PENGUIN_COLLECTIONS,
  type PenguinCollectionId,
} from "./lib/nftPenguin";

type StableCandidate = {
  name: string;
  score: number;
  landmarks: GestureResult["landmarks"];
  count: number;
};

type PenguinMode = "default" | "custom";
type LoadStatus = "idle" | "loading" | "success" | "error";

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
  const penguinModeRef = useRef<PenguinMode>("default");
  const customPenguinImageRef = useRef<HTMLImageElement | null>(null);
  const customPenguinCollectionRef = useRef<PenguinCollectionId | null>(null);

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
  const [penguinMode, setPenguinMode] = useState<PenguinMode>("default");
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<PenguinCollectionId>("lil-pudgy");
  const [tokenId, setTokenId] = useState("");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [customPenguinImage, setCustomPenguinImage] = useState<HTMLImageElement | null>(null);
  const [customPenguinCollectionId, setCustomPenguinCollectionId] =
    useState<PenguinCollectionId | null>(null);

  const camera = useCamera();
  const {
    recognize,
    isLoading: isRecognizerLoading,
    error: recognizerError,
  } = useGestureRecognizer(camera.isReady);
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
    penguinModeRef.current = penguinMode;
  }, [penguinMode]);

  useEffect(() => {
    customPenguinImageRef.current = customPenguinImage;
  }, [customPenguinImage]);

  useEffect(() => {
    customPenguinCollectionRef.current = customPenguinCollectionId;
  }, [customPenguinCollectionId]);

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
      if (document.hidden) {
        frameId = requestAnimationFrame(render);
        return;
      }

      const assets = assetsRef.current;
      const canvas = canvasRef.current;
      const video = camera.videoRef.current;
      const activeCustomPenguin =
        penguinModeRef.current === "custom" ? customPenguinImageRef.current : null;

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
          customPenguinImage: activeCustomPenguin,
          customPenguinCollectionId: activeCustomPenguin ? customPenguinCollectionRef.current : null,
          time,
        });
      }

      frameId = requestAnimationFrame(render);
    }

    frameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(frameId);
  }, [camera.isReady, camera.videoRef, recognize]);

  const handlePenguinModeChange = useCallback((nextMode: PenguinMode) => {
    setPenguinMode(nextMode);
    setDownloadMessage(null);
  }, []);

  const handleCollectionChange = useCallback((collectionId: PenguinCollectionId) => {
    setSelectedCollectionId(collectionId);
    setLoadStatus("idle");
  }, []);

  const handleTokenChange = useCallback((value: string) => {
    setTokenId(value);
    setLoadStatus("idle");
  }, []);

  const handleLoadPenguin = useCallback(async () => {
    const collection =
      PENGUIN_COLLECTIONS.find((item) => item.id === selectedCollectionId) ??
      PENGUIN_COLLECTIONS[0];

    try {
      setLoadStatus("loading");
      const loadedPenguin = await loadNftPenguin(collection, tokenId);
      setCustomPenguinImage(loadedPenguin.image);
      setCustomPenguinCollectionId(collection.id);
      setLoadStatus("success");
    } catch {
      setCustomPenguinImage(null);
      setCustomPenguinCollectionId(null);
      setLoadStatus("error");
    }
  }, [selectedCollectionId, tokenId]);

  const handleSnap = useCallback(async () => {
    const canvas = canvasRef.current;
    const assets = assetsRef.current;
    const video = camera.videoRef.current;
    const activeCustomPenguin =
      penguinModeRef.current === "custom" ? customPenguinImageRef.current : null;
    const activeCustomPenguinCollectionId = activeCustomPenguin
      ? customPenguinCollectionRef.current
      : null;
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
    const personMask = await createPersonMask(capturedCanvas);

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
        customPenguinImage: activeCustomPenguin,
        customPenguinCollectionId: activeCustomPenguinCollectionId,
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
          <span>✊ Not Today</span>
          <span>👍 Shine</span>
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

        {camera.isReady && !snapshot ? (
          <section className="penguin-picker" aria-label="Choose your penguin">
            <div className="picker-heading">
              <h2>Choose your penguin</h2>
              <p>Default Penguin is selected automatically.</p>
            </div>

            <div className="penguin-mode-toggle">
              <button
                type="button"
                className={penguinMode === "default" ? "is-selected" : ""}
                onClick={() => handlePenguinModeChange("default")}
              >
                Default Penguin
              </button>
              <button
                type="button"
                className={penguinMode === "custom" ? "is-selected" : ""}
                onClick={() => handlePenguinModeChange("custom")}
              >
                Custom NFT Penguin
              </button>
            </div>

            {penguinMode === "custom" ? (
              <div className="custom-penguin-panel">
                <div className="collection-options" aria-label="NFT collection selector">
                  {PENGUIN_COLLECTIONS.map((collection) => (
                    <button
                      key={collection.id}
                      type="button"
                      className={selectedCollectionId === collection.id ? "is-selected" : ""}
                      onClick={() => handleCollectionChange(collection.id)}
                    >
                      <img src={collection.icon} alt="" />
                      <span>{collection.name}</span>
                    </button>
                  ))}
                </div>

                <div className="token-loader">
                  <input
                    value={tokenId}
                    onChange={(event) => handleTokenChange(event.target.value)}
                    placeholder="Enter token ID, e.g. 11094"
                    aria-label="NFT token ID"
                  />
                  <button
                    type="button"
                    onClick={handleLoadPenguin}
                    disabled={loadStatus === "loading" || tokenId.trim().length === 0}
                  >
                    Load Penguin
                  </button>
                </div>

                {loadStatus !== "idle" ? (
                  <p className={`penguin-load-status ${loadStatus}`}>
                    {loadStatus === "loading" ? "Loading penguin..." : null}
                    {loadStatus === "success" ? "Penguin loaded!" : null}
                    {loadStatus === "error"
                      ? "Could not load this penguin. Please check the collection and token ID."
                      : null}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

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
