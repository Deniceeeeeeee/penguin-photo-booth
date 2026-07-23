import type { BoothAssets } from "./assets";
import type { Effect, GestureResult, Pose } from "./gestures";
import { getCaption, getReactionBubble } from "./gestures";
import type { PenguinCollectionId } from "./nftPenguin";

export const CANVAS_SIZE = 1080;

type DrawSceneOptions = {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement | null;
  assets: BoothAssets;
  pose: Pose;
  effect: Effect;
  gesture: GestureResult | null;
  poseChangedAt: number;
  snapStartedAt: number | null;
  customPenguinImage?: HTMLImageElement | null;
  customPenguinCollectionId?: PenguinCollectionId | null;
  time: number;
};

type DrawStickerSceneOptions = {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  personMask: ImageData;
  assets: BoothAssets;
  pose: Pose;
  effect: Effect;
  gesture: GestureResult | null;
  poseChangedAt: number;
  customPenguinImage?: HTMLImageElement | null;
  customPenguinCollectionId?: PenguinCollectionId | null;
  time: number;
};

const sparkleSeeds = [
  { x: 0.16, y: 0.18, size: 0.07, delay: 0 },
  { x: 0.82, y: 0.14, size: 0.06, delay: 0.8 },
  { x: 0.09, y: 0.48, size: 0.05, delay: 1.4 },
  { x: 0.73, y: 0.55, size: 0.08, delay: 0.35 },
  { x: 0.58, y: 0.76, size: 0.055, delay: 1.1 },
  { x: 0.89, y: 0.43, size: 0.045, delay: 1.7 },
];

const heartSeeds = [
  { x: 0.74, y: 0.83, size: 0.085, delay: 0 },
  { x: 0.86, y: 0.78, size: 0.065, delay: 0.7 },
  { x: 0.67, y: 0.7, size: 0.055, delay: 1.35 },
  { x: 0.79, y: 0.62, size: 0.075, delay: 1.9 },
  { x: 0.9, y: 0.68, size: 0.05, delay: 2.5 },
];

const poseScale: Record<Pose, number> = {
  base: 1,
  wave: 1.22,
  peace: 1,
  boss: 1,
  love: 1,
};

const handConnections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
] as const;

const fingertipIndexes = [4, 8, 12, 16, 20] as const;

const fingertipSeeds = [
  { dx: -18, dy: -16, delay: 0.1 },
  { dx: 18, dy: -22, delay: 0.4 },
  { dx: 3, dy: -34, delay: 0.7 },
] as const;

type CustomGestureKind = "base" | "wave" | "peace" | "not-today" | "shine" | "love";

type PenguinDrawPlacement = {
  x: number;
  y: number;
  size: number;
  centerX: number;
  centerY: number;
};

type VideoCoverTransform = {
  videoWidth: number;
  videoHeight: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
};

function getVideoCoverTransform(video: HTMLVideoElement): VideoCoverTransform {
  const videoWidth = video.videoWidth || CANVAS_SIZE;
  const videoHeight = video.videoHeight || CANVAS_SIZE;
  const sourceAspect = videoWidth / videoHeight;
  const targetAspect = 1;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = videoWidth;
  let sourceHeight = videoHeight;

  if (sourceAspect > targetAspect) {
    sourceWidth = videoHeight * targetAspect;
    sourceX = (videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = videoWidth / targetAspect;
    sourceY = (videoHeight - sourceHeight) / 2;
  }

  return {
    videoWidth,
    videoHeight,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    scale: CANVAS_SIZE / sourceWidth,
  };
}

function mirroredLandmarkPoint(landmark: { x: number; y: number }, transform: VideoCoverTransform) {
  const videoX = landmark.x * transform.videoWidth;
  const videoY = landmark.y * transform.videoHeight;
  const croppedX = (videoX - transform.sourceX) * transform.scale;
  const croppedY = (videoY - transform.sourceY) * transform.scale;

  return {
    x: CANVAS_SIZE - croppedX,
    y: croppedY,
  };
}

function coverVideo(ctx: CanvasRenderingContext2D, video: HTMLVideoElement) {
  const transform = getVideoCoverTransform(video);

  ctx.save();
  ctx.translate(CANVAS_SIZE, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    video,
    transform.sourceX,
    transform.sourceY,
    transform.sourceWidth,
    transform.sourceHeight,
    0,
    0,
    CANVAS_SIZE,
    CANVAS_SIZE,
  );
  ctx.restore();
}

function createInternalCanvas(width = CANVAS_SIZE, height = CANVAS_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawSegmentedVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  personMask: ImageData,
  gesture: GestureResult | null,
) {
  const videoCanvas = createInternalCanvas();
  const videoCtx = videoCanvas.getContext("2d");
  const maskSourceCanvas = createInternalCanvas(personMask.width, personMask.height);
  const maskSourceCtx = maskSourceCanvas.getContext("2d");
  const maskCanvas = createInternalCanvas();
  const maskCtx = maskCanvas.getContext("2d");

  if (!videoCtx || !maskSourceCtx || !maskCtx) {
    return;
  }

  coverVideo(videoCtx, video);
  maskSourceCtx.putImageData(personMask, 0, 0);
  maskCtx.drawImage(maskSourceCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawLandmarkMaskBoost(maskCtx, video, gesture);

  videoCtx.globalCompositeOperation = "destination-in";
  videoCtx.drawImage(maskCanvas, 0, 0);
  videoCtx.globalCompositeOperation = "source-over";
  ctx.drawImage(videoCanvas, 0, 0);
}

function drawLandmarkMaskBoost(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  gesture: GestureResult | null,
) {
  const landmarks = gesture?.landmarks;
  if (!landmarks?.length || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }

  const transform = getVideoCoverTransform(video);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = CANVAS_SIZE * 0.068;

  handConnections.forEach(([start, end]) => {
    const a = mirroredLandmarkPoint(landmarks[start], transform);
    const b = mirroredLandmarkPoint(landmarks[end], transform);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  landmarks.forEach((landmark, index) => {
    const point = mirroredLandmarkPoint(landmark, transform);
    const isTip = fingertipIndexes.includes(index as (typeof fingertipIndexes)[number]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, isTip ? CANVAS_SIZE * 0.055 : CANVAS_SIZE * 0.044, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  gradient.addColorStop(0, "#ffd8e8");
  gradient.addColorStop(0.5, "#fff8fb");
  gradient.addColorStop(1, "#c9f4ee");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

function drawEffects(ctx: CanvasRenderingContext2D, assets: BoothAssets, effect: Effect, time: number) {
  if (effect === "sparkle") {
    const image = assets.effects.sparkle;
    sparkleSeeds.forEach((seed) => {
      const wave = Math.sin(time * 0.004 + seed.delay * Math.PI);
      const pulse = 0.82 + (wave + 1) * 0.22;
      const alpha = 0.4 + (wave + 1) * 0.25;
      const size = CANVAS_SIZE * seed.size * pulse;
      const x = CANVAS_SIZE * seed.x;
      const y = CANVAS_SIZE * seed.y;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(Math.sin(time * 0.002 + seed.delay) * 0.32);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
    });
  }

  if (effect === "heart") {
    const image = assets.effects.heart;
    heartSeeds.forEach((seed) => {
      const cycle = ((time * 0.00028 + seed.delay) % 1 + 1) % 1;
      const floatY = cycle * CANVAS_SIZE * 0.3;
      const drift = Math.sin(cycle * Math.PI * 2 + seed.delay) * CANVAS_SIZE * 0.025;
      const alpha = Math.sin(cycle * Math.PI);
      const size = CANVAS_SIZE * seed.size * (0.9 + cycle * 0.3);

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(CANVAS_SIZE * seed.x + drift, CANVAS_SIZE * seed.y - floatY);
      ctx.rotate(Math.sin(cycle * Math.PI * 2) * 0.18);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
    });
  }
}

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  assets: BoothAssets,
  gesture: GestureResult | null,
  video: HTMLVideoElement | null,
  effect: Effect,
  time: number,
) {
  const landmarks = gesture?.landmarks;
  if (!landmarks?.length || !video || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }
  const gestureName = gesture?.name ?? "";
  const transform = getVideoCoverTransform(video);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = 8;
  ctx.shadowColor = "rgba(255, 95, 136, 0.45)";
  ctx.shadowBlur = 16;

  handConnections.forEach(([start, end]) => {
    const a = mirroredLandmarkPoint(landmarks[start], transform);
    const b = mirroredLandmarkPoint(landmarks[end], transform);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  landmarks.forEach((landmark, index) => {
    const point = mirroredLandmarkPoint(landmark, transform);
    const isTip = fingertipIndexes.includes(index as (typeof fingertipIndexes)[number]);
    const radius = isTip ? 15 + Math.sin(time * 0.01 + index) * 2 : 9;

    ctx.beginPath();
    ctx.fillStyle = isTip ? "#ff6f85" : "#ff8a76";
    ctx.shadowColor = isTip ? "rgba(255, 230, 112, 0.88)" : "rgba(255, 111, 133, 0.42)";
    ctx.shadowBlur = isTip ? 26 : 10;
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.arc(point.x - radius * 0.25, point.y - radius * 0.28, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
  });

  fingertipIndexes.forEach((index, tipNumber) => {
    const point = mirroredLandmarkPoint(landmarks[index], transform);
    fingertipSeeds.forEach((seed, seedIndex) => {
      const phase = ((time * 0.0016 + seed.delay + tipNumber * 0.16 + seedIndex * 0.09) % 1 + 1) % 1;
      const alpha = Math.sin(phase * Math.PI) * 0.72;
      const driftX = Math.sin(time * 0.004 + tipNumber + seedIndex) * 9;
      const x = point.x + seed.dx + driftX;
      const y = point.y + seed.dy - phase * 22;

      ctx.save();
      ctx.globalAlpha = alpha;

      if (gestureName === "ILoveYou" || effect === "heart") {
        const size = 24 + phase * 10;
        ctx.translate(x, y);
        ctx.rotate(Math.sin(time * 0.004 + seedIndex) * 0.16);
        ctx.drawImage(assets.effects.heart, -size / 2, -size / 2, size, size);
      } else if (gestureName === "Open_Palm") {
        drawTwinkle(ctx, x, y, 16 + phase * 9, "#fff38e");
      } else if (gestureName === "Victory") {
        drawTwinkle(ctx, x, y, 13 + phase * 8, "#bff7ff");
      } else {
        ctx.fillStyle = gestureName === "Closed_Fist" ? "#ff6f85" : "#fff38e";
        ctx.beginPath();
        ctx.arc(x, y, gestureName === "Closed_Fist" ? 7 + phase * 16 : 5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  });

  if (gestureName === "Closed_Fist") {
    const wrist = mirroredLandmarkPoint(landmarks[0], transform);
    const pulse = (time * 0.005) % 1;
    ctx.save();
    ctx.globalAlpha = 1 - pulse;
    ctx.strokeStyle = "#ff6f85";
    ctx.lineWidth = 7;
    ctx.shadowColor = "rgba(255, 111, 133, 0.6)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(wrist.x, wrist.y - 28, 40 + pulse * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawTwinkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.26, -size * 0.26);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.26, size * 0.26);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.26, size * 0.26);
  ctx.lineTo(-size, 0);
  ctx.lineTo(-size * 0.26, -size * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function getCustomGestureKind(pose: Pose, effect: Effect): CustomGestureKind {
  if (effect === "heart" || pose === "love") {
    return "love";
  }

  if (effect === "sparkle") {
    return "shine";
  }

  if (pose === "wave") {
    return "wave";
  }

  if (pose === "peace") {
    return "peace";
  }

  if (pose === "boss") {
    return "not-today";
  }

  return "base";
}

function getCustomGestureCopy(collectionId: PenguinCollectionId | null | undefined, kind: CustomGestureKind) {
  void collectionId;

  const customCopy: Record<CustomGestureKind, { bubble: string; caption: string }> = {
    base: { bubble: "Cute!", caption: "Make a gesture" },
    wave: { bubble: "Hello fam!", caption: "GM Mate" },
    peace: { bubble: "Yay!", caption: "Say Cheese" },
    "not-today": { bubble: "Not today!", caption: "Angry mode" },
    shine: { bubble: "All good!", caption: "Approveddd" },
    love: { bubble: "Love u!", caption: "Lovesss" },
  };

  return customCopy[kind];
}

function getCustomPenguinMotion(
  collectionId: PenguinCollectionId | null | undefined,
  kind: CustomGestureKind,
  time: number,
) {
  void collectionId;
  const base = { rotation: 0, scale: 1, offsetY: 0, offsetX: 0 };

  switch (kind) {
    case "wave":
      return { ...base, rotation: Math.sin(time * 0.01) * 0.055 };
    case "peace":
      return { ...base, offsetY: -Math.abs(Math.sin(time * 0.009)) * 14 };
    case "not-today":
      return {
        ...base,
        rotation: Math.sin(time * 0.018) * 0.025,
        offsetY: 8 + Math.sin(time * 0.004) * 8,
      };
    default:
      return base;
  }
}

function drawMotionLines(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color = "#ffffff") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(7, size * 0.06);
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 106, 145, 0.42)";
  ctx.shadowBlur = 14;
  for (let index = 0; index < 3; index += 1) {
    const offset = index * size * 0.14;
    ctx.beginPath();
    ctx.arc(x + offset, y + offset * 0.12, size * (0.28 + index * 0.07), -0.9, 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnnoyedMarks(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.strokeStyle = "#ff6f85";
  ctx.lineWidth = Math.max(8, size * 0.06);
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 111, 133, 0.45)";
  ctx.shadowBlur = 12;
  [
    [0, -1],
    [0.88, -0.48],
    [0.88, 0.48],
    [0, 1],
  ].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * size * 0.4, y + dy * size * 0.4);
    ctx.lineTo(x + dx * size * 0.78, y + dy * size * 0.78);
    ctx.stroke();
  });
  ctx.restore();
}

function drawSoftCloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = "#4d4050";
  ctx.shadowColor = "rgba(61, 36, 52, 0.3)";
  ctx.shadowBlur = 18;
  [
    { dx: -0.24, dy: 0.04, r: 0.22 },
    { dx: -0.04, dy: -0.08, r: 0.27 },
    { dx: 0.2, dy: 0.02, r: 0.22 },
    { dx: 0.03, dy: 0.12, r: 0.28 },
  ].forEach((part) => {
    ctx.beginPath();
    ctx.arc(x + size * part.dx, y + size * part.dy, size * part.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawCustomGestureOverlays(
  ctx: CanvasRenderingContext2D,
  assets: BoothAssets,
  collectionId: PenguinCollectionId | null | undefined,
  kind: CustomGestureKind,
  penguin: PenguinDrawPlacement,
  time: number,
) {
  if (kind === "base") {
    return;
  }

  void collectionId;
  const { x, y, size, centerX, centerY } = penguin;
  const bubbleLeft = clamp(x + size * 0.42, 28, CANVAS_SIZE - 245 - 28);
  const bubbleTop = clamp(y - 86 - 18 + Math.sin(time * 0.006) * 5, 28, CANVAS_SIZE - 86 - 76);
  const spots = [
    { x: clamp(bubbleLeft + 250, 720, CANVAS_SIZE - 70), y: clamp(bubbleTop + 118, 120, CANVAS_SIZE - 170) },
    { x: clamp(bubbleLeft + 210, 690, CANVAS_SIZE - 86), y: clamp(bubbleTop + 198, 170, CANVAS_SIZE - 145) },
    { x: clamp(centerX + size * 0.55, 720, CANVAS_SIZE - 72), y: clamp(y + size * 0.7, 360, CANVAS_SIZE - 145) },
    { x: clamp(x + size * 0.18, 610, CANVAS_SIZE - 255), y: clamp(y + size * 0.9, 510, CANVAS_SIZE - 132) },
  ];

  const drawEmoji = (emoji: string, xPos: number, yPos: number, scale = 0.13) => {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.font = `${Math.round(size * scale)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(61, 36, 52, 0.18)";
    ctx.shadowBlur = 10;
    ctx.fillText(emoji, xPos, yPos);
    ctx.restore();
  };

  if (kind === "wave") {
    drawMotionLines(ctx, spots[0].x, spots[0].y, size * 0.16, "#ffffff");
    drawMotionLines(ctx, spots[1].x, spots[1].y, size * 0.12, "#ffc6dd");
  }

  if (kind === "peace") {
    drawTwinkle(ctx, spots[0].x, spots[0].y, size * 0.04, "#fff38e");
    drawTwinkle(ctx, spots[1].x, spots[1].y, size * 0.035, "#bff7ff");
    drawTwinkle(ctx, spots[2].x, spots[2].y, size * 0.035, "#ffc6dd");
    drawEmoji("✌️", spots[0].x - size * 0.15, spots[0].y + size * 0.08);
    drawEmoji("✌️", spots[1].x - size * 0.12, spots[1].y + size * 0.08, 0.12);
  }

  if (kind === "not-today") {
    drawSoftCloud(ctx, spots[0].x, spots[0].y, size * 0.11);
    drawSoftCloud(ctx, spots[1].x, spots[1].y, size * 0.09);
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.font = `${Math.round(size * 0.12)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💤", spots[2].x, spots[2].y);
    ctx.fillText("💫", spots[3].x, spots[3].y);
    ctx.restore();
  }

  if (kind === "shine") {
    ctx.save();
    ctx.globalAlpha = 0.08 + Math.abs(Math.sin(time * 0.01)) * 0.08;
    const glow = ctx.createRadialGradient(centerX, centerY, size * 0.35, centerX, centerY, size * 0.86);
    glow.addColorStop(0, "#fff6a5");
    glow.addColorStop(1, "rgba(255, 246, 165, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let index = 0; index < 16; index += 1) {
      const spot = spots[index % spots.length];
      const blink = 0.35 + Math.abs(Math.sin(time * 0.012 + index * 0.9)) * 0.65;
      const offsetRadius = size * (0.04 + (index % 3) * 0.025);
      drawTwinkle(
        ctx,
        spot.x + Math.sin(time * 0.004 + index) * offsetRadius,
        spot.y + Math.cos(time * 0.004 + index) * offsetRadius,
        size * (0.032 + (index % 3) * 0.012) * blink,
        index % 2 ? "#fff38e" : "#ffc6dd",
      );
    }
  }

  if (kind === "love") {
    ctx.save();
    ctx.globalAlpha = 0.2 + Math.sin(time * 0.005) * 0.04;
    const glow = ctx.createRadialGradient(centerX, centerY, size * 0.08, centerX, centerY, size * 0.7);
    glow.addColorStop(0, "#ffc6dd");
    glow.addColorStop(1, "rgba(255, 198, 221, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    [...heartSeeds, ...heartSeeds.slice(0, 3)].forEach((seed, index) => {
      const phase = ((time * 0.00045 + seed.delay) % 1 + 1) % 1;
      const alpha = Math.sin(phase * Math.PI);
      const spot = spots[index % spots.length];
      const hx = spot.x + Math.sin(phase * Math.PI * 2 + index) * size * (0.025 + (index % 3) * 0.012);
      const hy = spot.y - phase * size * (0.13 + (index % 2) * 0.06);
      const heartSize = size * (0.065 + (index % 3) * 0.018);
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.drawImage(assets.effects.heart, hx, hy, heartSize, heartSize);
      ctx.restore();
    });
  }
}

function drawPenguin(
  ctx: CanvasRenderingContext2D,
  assets: BoothAssets,
  pose: Pose,
  effect: Effect,
  time: number,
  poseChangedAt: number,
  customPenguinImage?: HTMLImageElement | null,
  customPenguinCollectionId?: PenguinCollectionId | null,
): PenguinDrawPlacement {
  const image = customPenguinImage ?? assets.penguins[pose];
  const elapsed = Math.max(0, time - poseChangedAt);
  const pop = !customPenguinImage && elapsed < 420 ? 1 + Math.sin((elapsed / 420) * Math.PI) * 0.13 : 1;
  const customKind = getCustomGestureKind(pose, effect);
  const customMotion = customPenguinImage
    ? getCustomPenguinMotion(customPenguinCollectionId, customKind, time)
    : { rotation: 0, scale: 1, offsetY: 0, offsetX: 0 };
  const size =
    CANVAS_SIZE *
    0.36 *
    (customPenguinImage ? customMotion.scale : poseScale[pose]) *
    pop;
  const margin = CANVAS_SIZE * 0.005;
  const bounce = Math.sin(time * 0.004) * CANVAS_SIZE * 0.014;
  const wiggle = effect === "heart" ? Math.sin(time * 0.011) * 0.06 : 0;
  const x = CANVAS_SIZE - size - margin + customMotion.offsetX;
  const y = CANVAS_SIZE - size - CANVAS_SIZE * 0.055 + bounce + customMotion.offsetY;

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#3d2434";
  ctx.filter = "blur(8px)";
  ctx.beginPath();
  ctx.ellipse(x + size * 0.52, y + size * 0.94, size * 0.34, size * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(45, 25, 40, 0.2)";
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 18;
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(wiggle + customMotion.rotation);
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();

  return { x, y, size, centerX: x + size / 2, centerY: y + size / 2 };
}

function drawReactionBubble(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  effect: Effect,
  penguin: { x: number; y: number; size: number },
  time: number,
  poseChangedAt: number,
  customPenguinImage?: HTMLImageElement | null,
  customPenguinCollectionId?: PenguinCollectionId | null,
) {
  const elapsed = Math.max(0, time - poseChangedAt);
  if (!customPenguinImage && elapsed > 2800) {
    return;
  }

  const alpha = !customPenguinImage && elapsed > 2200 ? 1 - (elapsed - 2200) / 600 : 1;
  const customKind = getCustomGestureKind(pose, effect);
  const text = customPenguinImage
    ? getCustomGestureCopy(customPenguinCollectionId, customKind).bubble
    : getReactionBubble(pose, effect);
  const width = 245;
  const height = 86;
  const radius = 34;
  const x = clamp(penguin.x + penguin.size * 0.42, 28, CANVAS_SIZE - width - 28);
  const y = clamp(penguin.y - height - 18 + Math.sin(time * 0.006) * 5, 28, CANVAS_SIZE - height - 76);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(61, 36, 52, 0.2)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.beginPath();
  if (customPenguinImage) {
    ctx.moveTo(x + 56, y + height - 4);
    ctx.lineTo(Math.max(20, x + 14), Math.min(CANVAS_SIZE - 24, y + height + 34));
    ctx.lineTo(x + 104, y + height - 16);
  } else {
    ctx.moveTo(x + width - 72, y + height - 4);
    ctx.lineTo(x + width - 34, y + height + 36);
    ctx.lineTo(x + width - 112, y + height - 18);
  }
  ctx.closePath();
  ctx.fill();

  ctx.font = "900 34px Inter, ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#3d2434";
  ctx.fillText(text, x + width / 2, y + height / 2 + 1);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  effect: Effect,
  customPenguinImage?: HTMLImageElement | null,
  customPenguinCollectionId?: PenguinCollectionId | null,
) {
  const caption = customPenguinImage
    ? getCustomGestureCopy(customPenguinCollectionId, getCustomGestureKind(pose, effect)).caption
    : getCaption(pose, effect);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 66px Inter, ui-rounded, system-ui, sans-serif";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = 16;
  ctx.fillStyle = "#3d2434";
  ctx.strokeText(caption, CANVAS_SIZE / 2, CANVAS_SIZE - 120);
  ctx.fillText(caption, CANVAS_SIZE / 2, CANVAS_SIZE - 120);
  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = "700 28px Inter, ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(61, 36, 52, 0.72)";
  ctx.fillText("Penguin Photo Booth", CANVAS_SIZE - 34, 50);
  ctx.restore();
}

function drawSnapFlash(ctx: CanvasRenderingContext2D, time: number, snapStartedAt: number | null) {
  if (snapStartedAt === null) {
    return;
  }

  const elapsed = time - snapStartedAt;
  if (elapsed < 0 || elapsed > 520) {
    return;
  }

  const alpha = Math.max(0, 1 - elapsed / 520);
  ctx.save();
  ctx.globalAlpha = alpha * 0.82;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.globalAlpha = alpha;
  drawTwinkle(ctx, CANVAS_SIZE * 0.2, CANVAS_SIZE * 0.24, 44, "#fff38e");
  drawTwinkle(ctx, CANVAS_SIZE * 0.76, CANVAS_SIZE * 0.22, 34, "#ffc6dd");
  drawTwinkle(ctx, CANVAS_SIZE * 0.34, CANVAS_SIZE * 0.72, 30, "#bff7ff");
  ctx.restore();
}

export function drawScene({
  canvas,
  video,
  assets,
  pose,
  effect,
  gesture,
  poseChangedAt,
  snapStartedAt,
  customPenguinImage,
  customPenguinCollectionId,
  time,
}: DrawSceneOptions) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    coverVideo(ctx, video);
  } else {
    drawPlaceholder(ctx);
  }

  ctx.fillStyle = "rgba(255, 205, 226, 0.16)";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  drawHandOverlay(ctx, assets, gesture, video, effect, time);
  if (!customPenguinImage) {
    drawEffects(ctx, assets, effect, time);
  }
  drawCaption(ctx, pose, effect, customPenguinImage, customPenguinCollectionId);
  const penguin = drawPenguin(
    ctx,
    assets,
    pose,
    effect,
    time,
    poseChangedAt,
    customPenguinImage,
    customPenguinCollectionId,
  );
  if (customPenguinImage) {
    drawCustomGestureOverlays(
      ctx,
      assets,
      customPenguinCollectionId,
      getCustomGestureKind(pose, effect),
      penguin,
      time,
    );
  }
  drawReactionBubble(ctx, pose, effect, penguin, time, poseChangedAt, customPenguinImage, customPenguinCollectionId);
  drawWatermark(ctx);
  drawSnapFlash(ctx, time, snapStartedAt);
}

export function drawStickerScene({
  canvas,
  video,
  personMask,
  assets,
  pose,
  effect,
  gesture,
  poseChangedAt,
  customPenguinImage,
  customPenguinCollectionId,
  time,
}: DrawStickerSceneOptions) {
  const ctx = canvas.getContext("2d");
  if (!ctx || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawSegmentedVideo(ctx, video, personMask, gesture);
  drawHandOverlay(ctx, assets, gesture, video, effect, time);
  if (!customPenguinImage) {
    drawEffects(ctx, assets, effect, time);
  }
  drawCaption(ctx, pose, effect, customPenguinImage, customPenguinCollectionId);
  const penguin = drawPenguin(
    ctx,
    assets,
    pose,
    effect,
    time,
    poseChangedAt,
    customPenguinImage,
    customPenguinCollectionId,
  );
  if (customPenguinImage) {
    drawCustomGestureOverlays(
      ctx,
      assets,
      customPenguinCollectionId,
      getCustomGestureKind(pose, effect),
      penguin,
      time,
    );
  }
  drawReactionBubble(ctx, pose, effect, penguin, time, poseChangedAt, customPenguinImage, customPenguinCollectionId);
}
