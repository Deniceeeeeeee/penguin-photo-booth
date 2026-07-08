export type StickerSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export type StickerCutoutOptions = {
  source: StickerSource;
  mask?: HTMLCanvasElement | ImageData;
  preserveOverlayRegions?: Array<{ x: number; y: number; width: number; height: number }>;
  padding?: number;
  outlineColor?: string;
  outlineSize?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  backgroundThreshold?: number;
  trimAlphaThreshold?: number;
  removeCaptionBand?: boolean;
  removeWatermark?: boolean;
  useSourceAlpha?: boolean;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const DEFAULT_CAPTION_REGION = {
  x: 0,
  y: 0.72,
  width: 0.78,
  height: 0.24,
};

const DEFAULT_WATERMARK_REGION = {
  x: 0.58,
  y: 0,
  width: 0.42,
  height: 0.12,
};

const DEFAULT_OVERLAY_REGIONS = [
  { x: 0.45, y: 0.34, width: 0.55, height: 0.62 },
  { x: 0, y: 0.08, width: 0.48, height: 0.88 },
  { x: 0.62, y: 0.42, width: 0.38, height: 0.28 },
  { x: 0.74, y: 0.22, width: 0.26, height: 0.38 },
];

function getSourceSize(source: StickerSource) {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }

  return {
    width: source.width,
    height: source.height,
  };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not create sticker cutout canvas context.");
  }

  return ctx;
}

function drawSourceToCanvas(source: StickerSource) {
  const { width, height } = getSourceSize(source);
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function colorDistanceSquared(
  r: number,
  g: number,
  b: number,
  sample: readonly [number, number, number],
) {
  return (r - sample[0]) ** 2 + (g - sample[1]) ** 2 + (b - sample[2]) ** 2;
}

function sampleBackgroundColors(data: Uint8ClampedArray, width: number, height: number) {
  const samples: Array<[number, number, number]> = [];
  const step = Math.max(8, Math.floor(Math.min(width, height) / 36));

  function addSample(x: number, y: number) {
    const index = (y * width + x) * 4;
    samples.push([data[index], data[index + 1], data[index + 2]]);
  }

  for (let x = 0; x < width; x += step) {
    addSample(x, 0);
    addSample(x, height - 1);
  }

  for (let y = 0; y < height; y += step) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  return samples;
}

function isInCaptionRegion(x: number, y: number, width: number, height: number) {
  const regionX = DEFAULT_CAPTION_REGION.x * width;
  const regionY = DEFAULT_CAPTION_REGION.y * height;
  const regionWidth = DEFAULT_CAPTION_REGION.width * width;
  const regionHeight = DEFAULT_CAPTION_REGION.height * height;

  return x >= regionX && x <= regionX + regionWidth && y >= regionY && y <= regionY + regionHeight;
}

function isInWatermarkRegion(x: number, y: number, width: number, height: number) {
  const regionX = DEFAULT_WATERMARK_REGION.x * width;
  const regionY = DEFAULT_WATERMARK_REGION.y * height;
  const regionWidth = DEFAULT_WATERMARK_REGION.width * width;
  const regionHeight = DEFAULT_WATERMARK_REGION.height * height;

  return x >= regionX && x <= regionX + regionWidth && y >= regionY && y <= regionY + regionHeight;
}

function isInNormalizedRegions(
  x: number,
  y: number,
  width: number,
  height: number,
  regions: Array<{ x: number; y: number; width: number; height: number }>,
) {
  return regions.some((region) => {
    const regionX = region.x * width;
    const regionY = region.y * height;
    const regionWidth = region.width * width;
    const regionHeight = region.height * height;

    return x >= regionX && x <= regionX + regionWidth && y >= regionY && y <= regionY + regionHeight;
  });
}

function buildHeuristicMask(
  sourceImageData: ImageData,
  backgroundThreshold: number,
  removeCaptionBand: boolean,
  removeWatermark: boolean,
  preserveOverlayRegions?: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const { width, height, data } = sourceImageData;
  const thresholdSquared = backgroundThreshold ** 2;
  const backgroundSamples = sampleBackgroundColors(data, width, height);
  const mask = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const maskIndex = y * width + x;
      const alpha = data[pixelIndex + 3];

      if (
        alpha === 0 ||
        (removeCaptionBand && isInCaptionRegion(x, y, width, height)) ||
        (removeWatermark && isInWatermarkRegion(x, y, width, height))
      ) {
        mask[maskIndex] = 0;
        continue;
      }

      if (
        preserveOverlayRegions &&
        !isInNormalizedRegions(x, y, width, height, preserveOverlayRegions)
      ) {
        mask[maskIndex] = 0;
        continue;
      }

      const red = data[pixelIndex];
      const green = data[pixelIndex + 1];
      const blue = data[pixelIndex + 2];
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const saturation = maxChannel - minChannel;
      const isSpeechBubblePixel = maxChannel > 214 && minChannel > 190 && saturation < 38;
      const isHandOverlayPixel = red > 215 && green > 70 && green < 175 && blue > 80 && blue < 180;
      const isLikelyBoothOverlay =
        !preserveOverlayRegions ||
        isSpeechBubblePixel ||
        isHandOverlayPixel ||
        saturation > 42 ||
        maxChannel > 232 ||
        (red < 120 && green < 110 && blue < 130);

      if (!isLikelyBoothOverlay) {
        mask[maskIndex] = 0;
        continue;
      }

      const minDistance = backgroundSamples.reduce(
        (best, sample) => Math.min(best, colorDistanceSquared(red, green, blue, sample)),
        Number.POSITIVE_INFINITY,
      );

      mask[maskIndex] = minDistance > thresholdSquared ? 255 : 0;
    }
  }

  return mask;
}

function combineMasks(baseMask: Uint8ClampedArray, overlayMask: Uint8ClampedArray) {
  const combined = new Uint8ClampedArray(baseMask.length);

  for (let index = 0; index < combined.length; index += 1) {
    combined[index] = Math.max(baseMask[index], overlayMask[index]);
  }

  return combined;
}

function dilateMask(mask: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) {
    return mask;
  }

  const dilated = new Uint8ClampedArray(mask);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;

      if (mask[index] === 0) {
        continue;
      }

      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) {
          continue;
        }

        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width || offsetX ** 2 + offsetY ** 2 > radius ** 2) {
            continue;
          }

          dilated[nextY * width + nextX] = Math.max(dilated[nextY * width + nextX], mask[index]);
        }
      }
    }
  }

  return dilated;
}

function subtractUiRegions(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  removeCaptionBand: boolean,
  removeWatermark: boolean,
) {
  if (!removeCaptionBand && !removeWatermark) {
    return mask;
  }

  const cleaned = new Uint8ClampedArray(mask);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        (removeCaptionBand && isInCaptionRegion(x, y, width, height)) ||
        (removeWatermark && isInWatermarkRegion(x, y, width, height))
      ) {
        cleaned[y * width + x] = 0;
      }
    }
  }

  return cleaned;
}

function maskFromCanvas(maskCanvas: HTMLCanvasElement, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  ctx.drawImage(maskCanvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8ClampedArray(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = data[index * 4 + 3];
  }

  return mask;
}

function normalizeMask(mask: HTMLCanvasElement | ImageData, width: number, height: number) {
  if (mask instanceof HTMLCanvasElement) {
    return maskFromCanvas(mask, width, height);
  }

  const normalized = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor((x / width) * mask.width);
      const sourceY = Math.floor((y / height) * mask.height);
      const sourceAlpha = mask.data[(sourceY * mask.width + sourceX) * 4 + 3];
      normalized[y * width + x] = sourceAlpha > 42 ? 255 : sourceAlpha > 22 ? 210 : 0;
    }
  }

  return normalized;
}

function applyMask(sourceImageData: ImageData, mask: Uint8ClampedArray) {
  const output = new ImageData(
    new Uint8ClampedArray(sourceImageData.data),
    sourceImageData.width,
    sourceImageData.height,
  );

  for (let index = 0; index < mask.length; index += 1) {
    output.data[index * 4 + 3] = Math.min(output.data[index * 4 + 3], mask[index]);
  }

  return output;
}

function findAlphaBounds(imageData: ImageData, alphaThreshold: number): Bounds | null {
  const { width, height, data } = imageData;
  const bounds: Bounds = {
    minX: width,
    minY: height,
    maxX: -1,
    maxY: -1,
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha <= alphaThreshold) {
        continue;
      }

      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }

  return bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY ? bounds : null;
}

function cropImageData(imageData: ImageData, bounds: Bounds) {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = get2d(canvas);
  ctx.putImageData(imageData, 0, 0);

  const cropped = createCanvas(width, height);
  const croppedCtx = get2d(cropped);
  croppedCtx.drawImage(canvas, bounds.minX, bounds.minY, width, height, 0, 0, width, height);

  return cropped;
}

function createSolidAlphaCanvas(image: HTMLCanvasElement, color: string) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = get2d(canvas);

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);

  return canvas;
}

function drawDieCutOutline(
  ctx: CanvasRenderingContext2D,
  alphaShape: HTMLCanvasElement,
  x: number,
  y: number,
  outlineSize: number,
) {
  const steps = Math.max(24, Math.ceil(outlineSize * 2.4));

  for (let radius = outlineSize; radius > 0; radius -= Math.max(2, outlineSize / 4)) {
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      ctx.drawImage(
        alphaShape,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        alphaShape.width,
        alphaShape.height,
      );
    }
  }
}

export function createStickerCutout({
  source,
  mask,
  preserveOverlayRegions = DEFAULT_OVERLAY_REGIONS,
  padding = 36,
  outlineColor = "#ffffff",
  outlineSize = 18,
  shadowColor = "rgba(61, 36, 52, 0.24)",
  shadowBlur = 24,
  shadowOffsetX = 0,
  shadowOffsetY = 14,
  backgroundThreshold = 38,
  trimAlphaThreshold = 4,
  removeCaptionBand = true,
  removeWatermark = true,
  useSourceAlpha = false,
}: StickerCutoutOptions) {
  const sourceCanvas = drawSourceToCanvas(source);
  const sourceCtx = get2d(sourceCanvas);
  const sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  let maskedImageData = sourceImageData;

  if (!useSourceAlpha) {
    const heuristicMask = buildHeuristicMask(
      sourceImageData,
      mask ? Math.max(backgroundThreshold, 72) : backgroundThreshold,
      removeCaptionBand,
      removeWatermark,
      mask ? preserveOverlayRegions : undefined,
    );
    const alphaMask = mask
      ? combineMasks(
          dilateMask(
            normalizeMask(mask, sourceCanvas.width, sourceCanvas.height),
            sourceCanvas.width,
            sourceCanvas.height,
            8,
          ),
          heuristicMask,
        )
      : heuristicMask;
    const cleanedMask = subtractUiRegions(
      alphaMask,
      sourceCanvas.width,
      sourceCanvas.height,
      removeCaptionBand,
      removeWatermark,
    );
    maskedImageData = applyMask(sourceImageData, cleanedMask);
  }

  const bounds = findAlphaBounds(maskedImageData, trimAlphaThreshold);

  if (!bounds) {
    return createCanvas(1, 1);
  }

  const croppedForeground = cropImageData(maskedImageData, bounds);
  const stickerCanvas = createCanvas(
    croppedForeground.width + padding * 2,
    croppedForeground.height + padding * 2,
  );
  const stickerCtx = get2d(stickerCanvas);
  const alphaShape = createSolidAlphaCanvas(croppedForeground, outlineColor);

  stickerCtx.save();
  stickerCtx.shadowColor = shadowColor;
  stickerCtx.shadowBlur = shadowBlur;
  stickerCtx.shadowOffsetX = shadowOffsetX;
  stickerCtx.shadowOffsetY = shadowOffsetY;
  stickerCtx.globalAlpha = 0.88;
  drawDieCutOutline(stickerCtx, alphaShape, padding, padding, outlineSize);
  stickerCtx.restore();

  drawDieCutOutline(stickerCtx, alphaShape, padding, padding, outlineSize * 0.82);
  stickerCtx.drawImage(croppedForeground, padding, padding);

  return stickerCanvas;
}

export function stickerCutoutToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not export sticker cutout as PNG blob."));
      }
    }, "image/png");
  });
}
