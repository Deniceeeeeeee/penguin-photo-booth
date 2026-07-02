import { useCallback, useEffect, useRef, useState } from "react";
import { loadBoothAssets, type BoothAssets } from "./lib/assets";
import { CANVAS_SIZE, drawScene } from "./lib/drawScene";
import {
  getGestureLabel,
  mapGestureToState,
  type Effect,
  type GestureResult,
  type Pose,
} from "./lib/gestures";
import { useCamera } from "./lib/useCamera";
import { useGestureRecognizer } from "./lib/useGestureRecognizer";

type StableCandidate = {
  name: string;
  score: number;
  landmarks: GestureResult["landmarks"];
  count: number;
};

const INITIAL_POSE: Pose = "base";
const INITIAL_EFFECT: Effect = "none";
const SMOOTHING_FRAMES = 5;

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

  const [assetsReady, setAssetsReady] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>(INITIAL_POSE);
  const [effect, setEffect] = useState<Effect>(INITIAL_EFFECT);
  const [gesture, setGesture] = useState<GestureResult | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const camera = useCamera();
  const {
    recognize,
    isLoading: isRecognizerLoading,
    error: recognizerError,
  } = useGestureRecognizer();

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
    if (!canvas) {
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    setSnapshot(dataUrl);
    setDownloadMessage(null);
    snapStartedAtRef.current = performance.now();
  }, []);

  const handleDownload = useCallback(() => {
    if (!snapshot) {
      setDownloadMessage("Snap a penguin photo first.");
      return;
    }

    const link = document.createElement("a");
    link.href = snapshot;
    link.download = "penguin-photo-booth.png";
    link.click();
    setDownloadMessage(null);
  }, [snapshot]);

  const isLoading = !assetsReady || isRecognizerLoading;
  const error = assetError ?? recognizerError ?? camera.error;

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
          <button type="button" onClick={handleSnap} disabled={!assetsReady}>
            Take Cute Shot
          </button>
          <button type="button" onClick={handleDownload} disabled={!snapshot}>
            Save Photo
          </button>
        </div>
      </section>

      {snapshot ? (
        <section className="preview-panel" aria-label="Snapped penguin photo preview">
          <h2>Preview</h2>
          <img src={snapshot} alt="Snapped Penguin Photo Booth result" />
        </section>
      ) : null}
    </main>
  );
}
