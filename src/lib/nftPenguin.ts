import { removeBackground } from "@imgly/background-removal";

export type PenguinCollectionId = "lil-pudgy" | "pudgy-penguins";

export type PenguinCollection = {
  id: PenguinCollectionId;
  name: string;
  contract: string;
  icon: string;
};

export const PENGUIN_COLLECTIONS: readonly PenguinCollection[] = [
  {
    id: "lil-pudgy",
    name: "Lil Pudgy",
    contract: "0x524cab2ec69124574082676e6f654a18df49a048",
    icon: "/assets/lil-pudgy-collection-icon.jpg",
  },
  {
    id: "pudgy-penguins",
    name: "Pudgy Penguins",
    contract: "0xbd3531da5cf5857e7cfaa92426877b022e612cf8",
    icon: "/assets/pudgy-penguins-collection-icon.png",
  },
] as const;

type MetadataResponse = {
  image?: string;
  image_url?: string;
  imageUrl?: string;
};

const TOKEN_URI_SELECTOR = "0xc87b56dd";
const ETH_RPC_URL = "https://ethereum.publicnode.com";
const VISIBLE_ALPHA = 24;
const FLAT_BACKGROUND_CLOSE_DISTANCE = 34;
const CONTOUR_DILATION_RADIUS = 4;
const cleanedPenguinCache = new Map<string, Promise<HTMLImageElement>>();
const localPenguinOverrides: Partial<Record<PenguinCollectionId, Record<string, string>>> = {
  "pudgy-penguins": {
    "8013": "/custom-penguins/pudgy-penguins-8013.png",
    "2447": "/custom-penguins/pudgy-penguins-2447.png",
    "7365": "/custom-penguins/pudgy-penguins-7365.png",
    "5678": "/custom-penguins/pudgy-penguins-5678.png",
    "3950": "/custom-penguins/pudgy-penguins-3950.png",
  },
};

export function cleanTokenId(input: string) {
  return input.replace(/\s/g, "").replace(/#/g, "");
}

function lilPudgyLog(message: string) {
  console.log(`[Lil Pudgy] ${message}`);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function tokenIdToHex(tokenId: string) {
  const value = BigInt(tokenId);
  return value.toString(16).padStart(64, "0");
}

function normalizeTokenUri(hex: string) {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!cleanHex || /^0+$/.test(cleanHex)) {
    throw new Error("Missing token URI.");
  }

  const offset = Number.parseInt(cleanHex.slice(0, 64), 16) * 2;
  const length = Number.parseInt(cleanHex.slice(offset, offset + 64), 16) * 2;
  const uriHex = cleanHex.slice(offset + 64, offset + 64 + length);
  const bytes = uriHex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0/g, "");
}

export function toHttpUrl(uri: string) {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }

  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice("ar://".length)}`;
  }

  return uri;
}

function resolveMetadataImage(metadata: MetadataResponse) {
  const image = metadata.image ?? metadata.image_url ?? metadata.imageUrl;
  if (!image) {
    throw new Error("Metadata did not include an image.");
  }

  return toHttpUrl(image);
}

function loadImageFromBlob(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not load cleaned penguin image."));
    };

    image.src = objectUrl;
  });
}

async function loadImageBlob(imageUrl: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("Could not fetch penguin image.");
  }

  return response.blob();
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not process penguin image.");
  }

  return context;
}

function imageToImageData(image: HTMLImageElement, width = image.naturalWidth, height = image.naturalHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = getCanvasContext(canvas);
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not export cleaned penguin image."));
      }
    }, "image/png");
  });
}

function createMaskFromAlpha(data: Uint8ClampedArray, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (data[pixel * 4 + 3] >= VISIBLE_ALPHA) {
      mask[pixel] = 1;
    }
  }

  return mask;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(mask.length);

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) {
      continue;
    }

    const centerX = pixel % width;
    const centerY = Math.floor(pixel / width);
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const y = centerY + offsetY;
      if (y < 0 || y >= height) {
        continue;
      }

      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > radius * radius) {
          continue;
        }

        const x = centerX + offsetX;
        if (x >= 0 && x < width) {
          output[y * width + x] = 1;
        }
      }
    }
  }

  return output;
}

function isDarkLinePixel(data: Uint8ClampedArray, pixel: number) {
  const index = pixel * 4;
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const luma = red * 0.299 + green * 0.587 + blue * 0.114;
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return data[index + 3] >= VISIBLE_ALPHA && luma <= 82 && maxChannel <= 140 && maxChannel - minChannel <= 120;
}

function cleanEdgeBackgroundResidue(
  original: ImageData,
  subjectMask: Uint8Array,
  background: { red: number; green: number; blue: number },
) {
  const { data, width, height } = original;
  const cleanedMask = new Uint8Array(subjectMask);
  const visited = new Uint8Array(subjectMask.length);
  const queue = new Uint32Array(subjectMask.length);
  const component = new Uint32Array(subjectMask.length);
  const residueTolerance = 52;
  const maxResidueArea = Math.max(90, Math.round(subjectMask.length * 0.018));

  const isResidueCandidate = (pixel: number) => {
    if (!cleanedMask[pixel] || isDarkLinePixel(data, pixel)) {
      return false;
    }

    const index = pixel * 4;
    return colorDistance(data[index], data[index + 1], data[index + 2], background) <= residueTolerance;
  };

  for (let start = 0; start < subjectMask.length; start += 1) {
    if (visited[start] || !isResidueCandidate(start)) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let touchesSubjectEdge = false;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      component[area] = pixel;
      area += 1;

      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || !cleanedMask[neighbor]) {
          touchesSubjectEdge = true;
          continue;
        }

        if (!visited[neighbor] && isResidueCandidate(neighbor)) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const looksLikeSmallResidue =
      touchesSubjectEdge &&
      area <= maxResidueArea &&
      componentWidth < width * 0.26 &&
      componentHeight < height * 0.34;

    if (!looksLikeSmallResidue) {
      continue;
    }

    for (let i = 0; i < area; i += 1) {
      cleanedMask[component[i]] = 0;
    }
  }

  return cleanedMask;
}

function isPirateHatPenguin(original: ImageData) {
  const { data, width, height } = original;
  const scanHeight = Math.floor(height * 0.58);
  let navyHatPixels = 0;
  let paleTrimPixels = 0;

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < VISIBLE_ALPHA) {
        continue;
      }

      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luma = red * 0.299 + green * 0.587 + blue * 0.114;
      const isNavyHat = red <= 75 && green <= 82 && blue >= 78 && blue > red + 22 && blue > green + 10;
      const isPaleTrim = red >= 198 && green >= 190 && blue >= 105 && luma >= 178 && red - blue >= 26;

      if (isNavyHat) {
        navyHatPixels += 1;
      }

      if (isPaleTrim) {
        paleTrimPixels += 1;
      }
    }
  }

  const scannedPixels = width * scanHeight;
  return navyHatPixels > scannedPixels * 0.018 && paleTrimPixels > scannedPixels * 0.005;
}

function cleanPirateHatBackgroundResidue(
  original: ImageData,
  subjectMask: Uint8Array,
  background: { red: number; green: number; blue: number },
) {
  if (!isPirateHatPenguin(original)) {
    return subjectMask;
  }

  const { data, width, height } = original;
  const cleanedMask = new Uint8Array(subjectMask);
  const visited = new Uint8Array(subjectMask.length);
  const queue = new Uint32Array(subjectMask.length);
  const component = new Uint32Array(subjectMask.length);
  const backgroundTolerance = 112;
  const maxPocketArea = Math.max(180, Math.round(subjectMask.length * 0.09));

  const isBlueBackgroundCandidate = (pixel: number) => {
    if (!cleanedMask[pixel] || isDarkLinePixel(data, pixel)) {
      return false;
    }

    const y = Math.floor(pixel / width);
    if (y > height * 0.56) {
      return false;
    }

    const index = pixel * 4;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const distance = colorDistance(red, green, blue, background);
    const looksLikeCoolHatBackground = green > red + 18 && blue > red + 18 && Math.abs(green - blue) < 58;
    const looksLikeFeatherOrTrim = red > 160 && green > 140 && blue < 185 && red >= blue + 16;

    return distance <= backgroundTolerance && looksLikeCoolHatBackground && !looksLikeFeatherOrTrim;
  };

  for (let start = 0; start < cleanedMask.length; start += 1) {
    if (visited[start] || !isBlueBackgroundCandidate(start)) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let touchesTransparent = false;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      component[area] = pixel;
      area += 1;

      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || !cleanedMask[neighbor]) {
          touchesTransparent = true;
          continue;
        }

        if (!visited[neighbor] && isBlueBackgroundCandidate(neighbor)) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const isHatGapBackground =
      area <= maxPocketArea &&
      minY < height * 0.38 &&
      maxY < height * 0.56 &&
      componentWidth < width * 0.7 &&
      componentHeight < height * 0.42;

    if (!touchesTransparent && !isHatGapBackground) {
      continue;
    }

    for (let i = 0; i < area; i += 1) {
      cleanedMask[component[i]] = 0;
    }
  }

  return cleanedMask;
}

function drawStickerFromMask(original: ImageData, subjectMask: Uint8Array) {
  const { width, height, data } = original;
  const background = findDominantBorderColor(data, width, height);
  const cleanedSubjectMask = cleanPirateHatBackgroundResidue(original, cleanEdgeBackgroundResidue(
    original,
    subjectMask,
    background,
  ), background);
  const outlineRadius = Math.max(8, Math.round(Math.max(width, height) * 0.016));
  const padding = outlineRadius + Math.max(8, Math.round(Math.max(width, height) * 0.012));
  const outlineMask = dilateMask(cleanedSubjectMask, width, height, outlineRadius);
  const canvas = document.createElement("canvas");
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = getCanvasContext(canvas);
  const sticker = context.createImageData(canvas.width, canvas.height);

  for (let pixel = 0; pixel < outlineMask.length; pixel += 1) {
    if (!outlineMask[pixel]) {
      continue;
    }

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const target = ((y + padding) * canvas.width + x + padding) * 4;
    sticker.data[target] = 255;
    sticker.data[target + 1] = 255;
    sticker.data[target + 2] = 255;
    sticker.data[target + 3] = 255;
  }

  for (let pixel = 0; pixel < cleanedSubjectMask.length; pixel += 1) {
    if (!cleanedSubjectMask[pixel]) {
      continue;
    }

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const source = pixel * 4;
    const target = ((y + padding) * canvas.width + x + padding) * 4;
    sticker.data[target] = data[source];
    sticker.data[target + 1] = data[source + 1];
    sticker.data[target + 2] = data[source + 2];
    sticker.data[target + 3] = Math.max(data[source + 3], 255);
  }

  context.putImageData(sticker, 0, 0);
  return canvasToBlob(canvas);
}

function drawStickerFromAlphaOnly(original: ImageData) {
  const { width, height, data } = original;
  const subjectMask = createMaskFromAlpha(data, width, height);
  const outlineRadius = Math.max(8, Math.round(Math.max(width, height) * 0.016));
  const padding = outlineRadius + Math.max(8, Math.round(Math.max(width, height) * 0.012));
  const outlineMask = dilateMask(subjectMask, width, height, outlineRadius);
  const canvas = document.createElement("canvas");
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = getCanvasContext(canvas);
  const sticker = context.createImageData(canvas.width, canvas.height);

  for (let pixel = 0; pixel < outlineMask.length; pixel += 1) {
    if (!outlineMask[pixel]) {
      continue;
    }

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const target = ((y + padding) * canvas.width + x + padding) * 4;
    sticker.data[target] = 255;
    sticker.data[target + 1] = 255;
    sticker.data[target + 2] = 255;
    sticker.data[target + 3] = 255;
  }

  for (let pixel = 0; pixel < subjectMask.length; pixel += 1) {
    if (!subjectMask[pixel]) {
      continue;
    }

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const source = pixel * 4;
    const target = ((y + padding) * canvas.width + x + padding) * 4;
    sticker.data[target] = data[source];
    sticker.data[target + 1] = data[source + 1];
    sticker.data[target + 2] = data[source + 2];
    sticker.data[target + 3] = data[source + 3];
  }

  context.putImageData(sticker, 0, 0);
  return canvasToBlob(canvas);
}

function findDominantBorderColor(data: Uint8ClampedArray, width: number, height: number) {
  const bins = new Map<string, { count: number; red: number; green: number; blue: number }>();
  const addSample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < VISIBLE_ALPHA) {
      return;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const key = `${red >> 4},${green >> 4},${blue >> 4}`;
    const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bin.count += 1;
    bin.red += red;
    bin.green += green;
    bin.blue += blue;
    bins.set(key, bin);
  };

  for (let x = 0; x < width; x += 1) {
    addSample(x, 0);
    addSample(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  let dominant = { count: 0, red: 255, green: 255, blue: 255 };
  bins.forEach((bin) => {
    if (bin.count > dominant.count) {
      dominant = bin;
    }
  });

  return {
    red: dominant.red / Math.max(1, dominant.count),
    green: dominant.green / Math.max(1, dominant.count),
    blue: dominant.blue / Math.max(1, dominant.count),
  };
}

function colorDistance(
  red: number,
  green: number,
  blue: number,
  background: { red: number; green: number; blue: number },
) {
  const redDelta = red - background.red;
  const greenDelta = green - background.green;
  const blueDelta = blue - background.blue;
  return Math.sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta);
}

function analyzeFlatBorderBackground(data: Uint8ClampedArray, width: number, height: number) {
  const background = findDominantBorderColor(data, width, height);
  let sampleCount = 0;
  let closeCount = 0;
  let closeDistanceTotal = 0;

  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < VISIBLE_ALPHA) {
      return;
    }

    sampleCount += 1;
    const distance = colorDistance(data[index], data[index + 1], data[index + 2], background);
    if (distance <= FLAT_BACKGROUND_CLOSE_DISTANCE) {
      closeCount += 1;
      closeDistanceTotal += distance;
    }
  };

  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }

  const closeRatio = closeCount / Math.max(1, sampleCount);
  const averageCloseDistance = closeDistanceTotal / Math.max(1, closeCount);
  return {
    background,
    isFlat: closeRatio >= 0.72,
    tolerance: Math.min(86, Math.max(42, averageCloseDistance * 2.6 + 24)),
  };
}

function createDarkContourBarrier(data: Uint8ClampedArray, width: number, height: number) {
  const length = width * height;
  const darkPixels = new Uint8Array(length);
  const barrier = new Uint8Array(length);

  for (let pixel = 0; pixel < length; pixel += 1) {
    const index = pixel * 4;
    if (data[index + 3] < VISIBLE_ALPHA) {
      continue;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);

    if (luma <= 98 && maxChannel <= 170 && maxChannel - minChannel <= 118) {
      darkPixels[pixel] = 1;
    }
  }

  for (let pixel = 0; pixel < length; pixel += 1) {
    if (!darkPixels[pixel]) {
      continue;
    }

    const centerX = pixel % width;
    const centerY = Math.floor(pixel / width);
    for (let offsetY = -CONTOUR_DILATION_RADIUS; offsetY <= CONTOUR_DILATION_RADIUS; offsetY += 1) {
      const y = centerY + offsetY;
      if (y < 0 || y >= height) {
        continue;
      }

      for (let offsetX = -CONTOUR_DILATION_RADIUS; offsetX <= CONTOUR_DILATION_RADIUS; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > CONTOUR_DILATION_RADIUS * CONTOUR_DILATION_RADIUS) {
          continue;
        }

        const x = centerX + offsetX;
        if (x >= 0 && x < width) {
          barrier[y * width + x] = 1;
        }
      }
    }
  }

  return barrier;
}

function createEdgeBackgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 58,
  background = findDominantBorderColor(data, width, height),
  barrier?: Uint8Array,
  seedBottom = true,
) {
  const length = width * height;
  const mask = new Uint8Array(length);
  const queue = new Uint32Array(length);
  let head = 0;
  let tail = 0;

  const isBackgroundLike = (pixel: number) => {
    const index = pixel * 4;
    return (
      data[index + 3] < VISIBLE_ALPHA ||
      colorDistance(data[index], data[index + 1], data[index + 2], background) <= tolerance
    );
  };

  const enqueue = (pixel: number) => {
    if (mask[pixel] || barrier?.[pixel] || !isBackgroundLike(pixel)) {
      return;
    }

    mask[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    if (seedBottom) {
      enqueue((height - 1) * width + x);
    }
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x < width - 1) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y < height - 1) enqueue(pixel + width);
  }

  return { mask, background };
}

function removeTrappedBackgroundResidue(
  imageData: ImageData,
  background: { red: number; green: number; blue: number },
  tolerance: number,
  barrier: Uint8Array,
) {
  const { data, width, height } = imageData;
  const length = width * height;
  const visited = new Uint8Array(length);
  const queue = new Uint32Array(length);
  const component = new Uint32Array(length);
  const residueTolerance = Math.min(104, tolerance + 24);
  const maxResidueArea = Math.max(320, Math.round(length * 0.085));
  const maxUpperHatGapArea = Math.max(420, Math.round(length * 0.04));

  const isCandidate = (pixel: number) => {
    if (barrier[pixel]) {
      return false;
    }

    const index = pixel * 4;
    return (
      data[index + 3] >= VISIBLE_ALPHA &&
      colorDistance(data[index], data[index + 1], data[index + 2], background) <= residueTolerance
    );
  };

  for (let start = 0; start < length; start += 1) {
    if (visited[start] || !isCandidate(start)) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let touchesTransparent = false;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      component[area] = pixel;
      area += 1;

      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0) {
          touchesTransparent = true;
          continue;
        }

        if (data[neighbor * 4 + 3] < VISIBLE_ALPHA) {
          touchesTransparent = true;
          continue;
        }

        if (!visited[neighbor] && isCandidate(neighbor)) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const isEdgeResidue = touchesTransparent && area <= maxResidueArea;
    const isUpperHatGapResidue =
      !touchesTransparent &&
      area <= maxUpperHatGapArea &&
      minY < height * 0.3 &&
      maxY < height * 0.5 &&
      componentWidth < width * 0.5 &&
      componentHeight < height * 0.35;

    if (!isEdgeResidue && !isUpperHatGapResidue) {
      continue;
    }

    for (let i = 0; i < area; i += 1) {
      data[component[i] * 4 + 3] = 0;
    }
  }
}

async function removeFlatConnectedBackground(originalBlob: Blob) {
  const originalImage = await loadImageFromBlob(originalBlob);
  const width = originalImage.naturalWidth;
  const height = originalImage.naturalHeight;
  const original = imageToImageData(originalImage, width, height);
  const analysis = analyzeFlatBorderBackground(original.data, width, height);

  if (!analysis.isFlat) {
    return null;
  }

  const contourBarrier = createDarkContourBarrier(original.data, width, height);
  const { mask } = createEdgeBackgroundMask(
    original.data,
    width,
    height,
    analysis.tolerance,
    analysis.background,
    contourBarrier,
    false,
  );
  const cleaned = new ImageData(new Uint8ClampedArray(original.data), width, height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (mask[pixel]) {
      cleaned.data[pixel * 4 + 3] = 0;
    }
  }

  return drawStickerFromMask(original, createMaskFromAlpha(cleaned.data, width, height));
}

function createOutsideTransparentMask(subjectMask: Uint8Array, width: number, height: number) {
  const length = width * height;
  const mask = new Uint8Array(length);
  const queue = new Uint32Array(length);
  let head = 0;
  let tail = 0;

  const enqueue = (pixel: number) => {
    if (mask[pixel] || subjectMask[pixel]) {
      return;
    }

    mask[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x < width - 1) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y < height - 1) enqueue(pixel + width);
  }

  return mask;
}

function createDistanceFromSubject(subjectMask: Uint8Array, width: number, height: number) {
  const length = width * height;
  const maxDistance = width + height;
  const distance = new Uint32Array(length);

  for (let pixel = 0; pixel < length; pixel += 1) {
    distance[pixel] = subjectMask[pixel] ? 0 : maxDistance;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      let value = distance[pixel];
      if (x > 0) value = Math.min(value, distance[pixel - 1] + 1);
      if (y > 0) value = Math.min(value, distance[pixel - width] + 1);
      distance[pixel] = value;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const pixel = y * width + x;
      let value = distance[pixel];
      if (x < width - 1) value = Math.min(value, distance[pixel + 1] + 1);
      if (y < height - 1) value = Math.min(value, distance[pixel + width] + 1);
      distance[pixel] = value;
    }
  }

  return distance;
}

async function repairPenguinCutout(originalBlob: Blob, cutoutBlob: Blob) {
  const [originalImage, cutoutImage] = await Promise.all([
    loadImageFromBlob(originalBlob),
    loadImageFromBlob(cutoutBlob),
  ]);
  const width = originalImage.naturalWidth;
  const height = originalImage.naturalHeight;
  const original = imageToImageData(originalImage, width, height);
  const cutout = imageToImageData(cutoutImage, width, height);
  const length = width * height;
  const subjectMask = new Uint8Array(length);
  let hasSubject = false;

  for (let pixel = 0; pixel < length; pixel += 1) {
    if (cutout.data[pixel * 4 + 3] > VISIBLE_ALPHA) {
      subjectMask[pixel] = 1;
      hasSubject = true;
    }
  }

  if (!hasSubject) {
    return cutoutBlob;
  }

  const { mask: edgeBackground, background } = createEdgeBackgroundMask(original.data, width, height);
  const outsideTransparent = createOutsideTransparentMask(subjectMask, width, height);
  const distance = createDistanceFromSubject(subjectMask, width, height);
  const repairDistance = Math.max(10, Math.round(Math.max(width, height) * 0.055));
  const repaired = new ImageData(new Uint8ClampedArray(cutout.data), width, height);

  for (let pixel = 0; pixel < length; pixel += 1) {
    if (subjectMask[pixel]) {
      continue;
    }

    const originalIndex = pixel * 4;
    const isInternalHole = !outsideTransparent[pixel];
    const isNearbyMissingSubject = !edgeBackground[pixel] && distance[pixel] <= repairDistance;

    if (!isInternalHole && !isNearbyMissingSubject) {
      continue;
    }

    const looksLikeOriginalBackground =
      original.data[originalIndex + 3] < VISIBLE_ALPHA ||
      colorDistance(
        original.data[originalIndex],
        original.data[originalIndex + 1],
        original.data[originalIndex + 2],
        background,
      ) <= 58;

    if (looksLikeOriginalBackground && !isNearbyMissingSubject) {
      continue;
    }

    repaired.data[originalIndex] = original.data[originalIndex];
    repaired.data[originalIndex + 1] = original.data[originalIndex + 1];
    repaired.data[originalIndex + 2] = original.data[originalIndex + 2];
    repaired.data[originalIndex + 3] = Math.max(original.data[originalIndex + 3], 255);
  }

  return drawStickerFromMask(original, createMaskFromAlpha(repaired.data, width, height));
}

async function removePenguinBackground(imageUrl: string) {
  const imageBlob = await loadImageBlob(imageUrl);
  const flatCutoutBlob = await removeFlatConnectedBackground(imageBlob);
  if (flatCutoutBlob) {
    return flatCutoutBlob;
  }

  try {
    const cutoutBlob = await removeBackground(imageBlob, {
      model: "isnet_fp16",
      output: { format: "image/png" },
    });
    return repairPenguinCutout(imageBlob, cutoutBlob);
  } catch {
    const cutoutBlob = await removeBackground(imageUrl, {
      model: "isnet_fp16",
      output: { format: "image/png" },
    });
    return repairPenguinCutout(imageBlob, cutoutBlob);
  }
}

async function removeLilPudgyBackgroundWithRemoveBg(imageUrl: string, tokenId: string) {
  lilPudgyLog(`Calling remove.bg for Lil Pudgy token ${tokenId}`);
  const response = await fetch("/api/remove-bg", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });

  lilPudgyLog(`remove.bg response status code: ${response.status}`);

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`remove.bg cleanup failed (${response.status}). ${message}`.trim());
  }

  const cutoutBlob = await response.blob();
  if (cutoutBlob.type && cutoutBlob.type !== "image/png") {
    throw new Error(`remove.bg returned ${cutoutBlob.type} instead of image/png.`);
  }

  const cutoutImage = await loadImageFromBlob(cutoutBlob);
  const cutout = imageToImageData(cutoutImage);
  return drawStickerFromAlphaOnly(cutout);
}

function loadCleanPenguinImage(imageUrl: string) {
  const cached = cleanedPenguinCache.get(imageUrl);
  if (cached) {
    return cached;
  }

  const cleanedImage = removePenguinBackground(imageUrl)
    .then((blob) => loadImageFromBlob(blob))
    .catch((error) => {
      cleanedPenguinCache.delete(imageUrl);
      throw error;
    });

  cleanedPenguinCache.set(imageUrl, cleanedImage);
  return cleanedImage;
}

function loadRemoveBgPenguinImage(imageUrl: string, tokenId: string) {
  const cacheKey = `remove-bg-direct:${tokenId}:${imageUrl}`;
  const cached = cleanedPenguinCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cleanedImage = removeLilPudgyBackgroundWithRemoveBg(imageUrl, tokenId)
    .then((blob) => loadImageFromBlob(blob))
    .catch((error) => {
      cleanedPenguinCache.delete(cacheKey);
      throw error;
    });

  cleanedPenguinCache.set(cacheKey, cleanedImage);
  return cleanedImage;
}

async function loadLocalOutlinedPenguinImage(imageUrl: string) {
  const cached = cleanedPenguinCache.get(imageUrl);
  if (cached) {
    return cached;
  }

  const outlinedImage = loadImageBlob(imageUrl)
    .then((blob) => loadImageFromBlob(blob))
    .then((image) => {
      const imageData = imageToImageData(image);
      return drawStickerFromMask(imageData, createMaskFromAlpha(imageData.data, imageData.width, imageData.height));
    })
    .then((blob) => loadImageFromBlob(blob))
    .catch((error) => {
      cleanedPenguinCache.delete(imageUrl);
      throw error;
    });

  cleanedPenguinCache.set(imageUrl, outlinedImage);
  return outlinedImage;
}

async function resolveLocalPenguinOverride(collection: PenguinCollection, tokenId: string) {
  const mappedOverride = localPenguinOverrides[collection.id]?.[tokenId];
  if (mappedOverride) {
    return mappedOverride;
  }

  return null;
}

async function localImageExists(localPath: string) {
  try {
    const response = await fetch(localPath, { method: "HEAD" });
    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get("content-type") ?? "";
    return !contentType || contentType.includes("image") || contentType.includes("octet-stream");
  } catch {
    return false;
  }
}

export async function loadNftPenguin(collection: PenguinCollection, rawTokenId: string) {
  const tokenId = cleanTokenId(rawTokenId);
  if (!/^\d+$/.test(tokenId)) {
    throw new Error("Token ID must be a number.");
  }

  const isLilPudgy = collection.id === "lil-pudgy";
  const lilPudgyLocalPath = `/custom-penguins/lil-pudgy-${tokenId}.png`;
  if (isLilPudgy) {
    lilPudgyLog(`entered token ID: ${rawTokenId}`);
    lilPudgyLog(`normalized token ID: ${tokenId}`);
    lilPudgyLog(`local override path checked: ${lilPudgyLocalPath}`);
  }

  let localImageUrl: string | null = null;
  if (isLilPudgy) {
    const hasLilPudgyOverride = await localImageExists(lilPudgyLocalPath);
    lilPudgyLog(`local override found: ${hasLilPudgyOverride}`);
    localImageUrl = hasLilPudgyOverride ? lilPudgyLocalPath : null;
  } else {
    localImageUrl = await resolveLocalPenguinOverride(collection, tokenId);
  }

  if (localImageUrl) {
    try {
      const image = await loadLocalOutlinedPenguinImage(localImageUrl);
      if (isLilPudgy) {
        lilPudgyLog("Using local Lil Pudgy override");
        lilPudgyLog("source used: local override");
      }
      return { tokenId, imageUrl: localImageUrl, image };
    } catch (error) {
      if (isLilPudgy) {
        lilPudgyLog(`local override error message: ${getErrorMessage(error, "Could not load local penguin override.")}`);
      } else {
        throw new Error("Could not load local penguin override.");
      }
    }
  }

  try {
    const response = await fetch(ETH_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: collection.contract,
            data: `${TOKEN_URI_SELECTOR}${tokenIdToHex(tokenId)}`,
          },
          "latest",
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("Could not fetch token URI.");
    }

    const rpcResult = (await response.json()) as { result?: string; error?: unknown };
    if (!rpcResult.result || rpcResult.error) {
      throw new Error("Could not fetch token URI.");
    }

    const metadataUrl = toHttpUrl(normalizeTokenUri(rpcResult.result));
    if (isLilPudgy) {
      lilPudgyLog(`metadata URL being fetched: ${metadataUrl}`);
    }

    const metadataResponse = await fetch(metadataUrl);
    if (isLilPudgy) {
      lilPudgyLog(`metadata fetch status: ${metadataResponse.status} ${metadataResponse.ok ? "ok" : "failed"}`);
    }

    if (!metadataResponse.ok) {
      throw new Error("Could not fetch metadata.");
    }

    const metadata = (await metadataResponse.json()) as MetadataResponse;
    const imageUrl = resolveMetadataImage(metadata);
    if (isLilPudgy) {
      lilPudgyLog(`original image URL found: ${imageUrl}`);
      lilPudgyLog("/api/remove-bg called: true");
    }

    if (isLilPudgy) {
      try {
        const image = await loadRemoveBgPenguinImage(imageUrl, tokenId);
        lilPudgyLog(`remove.bg success for Lil Pudgy token ${tokenId}`);
        lilPudgyLog("source used: remove.bg");
        return { tokenId, imageUrl, image };
      } catch (error) {
        lilPudgyLog(`remove.bg failed for Lil Pudgy token ${tokenId}, falling back to existing cleanup`);
        lilPudgyLog(`remove.bg error message: ${getErrorMessage(error, "Unknown remove.bg error.")}`);

        try {
          const image = await loadCleanPenguinImage(imageUrl);
          lilPudgyLog("source used: fallback cleanup");
          return { tokenId, imageUrl, image };
        } catch (fallbackError) {
          lilPudgyLog(`fallback cleanup error message: ${getErrorMessage(fallbackError, "Unknown fallback cleanup error.")}`);
          throw fallbackError;
        }
      }
    }

    const image = await loadCleanPenguinImage(imageUrl);

    return { tokenId, imageUrl, image };
  } catch (error) {
    if (isLilPudgy) {
      lilPudgyLog("source used: failed");
    }

    throw error;
  }
}
