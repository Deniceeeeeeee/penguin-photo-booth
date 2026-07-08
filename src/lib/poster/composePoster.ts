import {
  POSTER_WIDTH_CM,
  posterTemplates,
  type PosterTemplate,
} from "../../config/posterTemplates";

export type PosterSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export type ComposePosterOptions = {
  stickerCutout: PosterSource;
  template?: PosterTemplate;
  templates?: readonly PosterTemplate[];
  random?: () => number;
  mimeType?: "image/png";
};

export type ComposedPosterResult = {
  selectedPosterId: string;
  selectedPosterName: string;
  selectedPoster: PosterTemplate;
  composedCanvas: HTMLCanvasElement;
  blob: Blob;
  dataURL: string;
};

function getSourceSize(source: PosterSource) {
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
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not create poster canvas context.");
  }

  return ctx;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load poster image: ${src}`));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: "image/png") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not export composed poster as PNG blob."));
      }
    }, mimeType);
  });
}

export function chooseRandomPosterTemplate(
  templates: readonly PosterTemplate[] = posterTemplates,
  random = Math.random,
) {
  if (templates.length === 0) {
    throw new Error("No poster templates are available.");
  }

  return templates[Math.floor(random() * templates.length)] ?? templates[0];
}

function drawCutoutInSlot(
  ctx: CanvasRenderingContext2D,
  cutout: PosterSource,
  template: PosterTemplate,
  posterWidth: number,
) {
  const { unit, x: slotX, y: slotY, width, height, rotation } = template.photoSlot;
  const pixelsPerCm = posterWidth / POSTER_WIDTH_CM;
  const x = unit === "cm" ? slotX * pixelsPerCm : slotX;
  const y = unit === "cm" ? slotY * pixelsPerCm : slotY;
  const slotWidth = unit === "cm" ? width * pixelsPerCm : width;
  const slotHeight = unit === "cm" ? height * pixelsPerCm : height;
  const { width: cutoutWidth, height: cutoutHeight } = getSourceSize(cutout);
  const scale = Math.min(slotWidth / cutoutWidth, slotHeight / cutoutHeight);
  const drawWidth = cutoutWidth * scale;
  const drawHeight = cutoutHeight * scale;

  ctx.save();
  ctx.translate(x + slotWidth / 2, y + slotHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.beginPath();
  ctx.rect(-slotWidth / 2, -slotHeight / 2, slotWidth, slotHeight);
  ctx.clip();
  ctx.drawImage(cutout, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

export async function composePoster({
  stickerCutout,
  template,
  templates = posterTemplates,
  random,
  mimeType = "image/png",
}: ComposePosterOptions): Promise<ComposedPosterResult> {
  const selectedPoster = template ?? chooseRandomPosterTemplate(templates, random);
  const posterImage = await loadImage(selectedPoster.image);
  const posterWidth = posterImage.naturalWidth || posterImage.width;
  const posterHeight = posterImage.naturalHeight || posterImage.height;
  const composedCanvas = createCanvas(posterWidth, posterHeight);
  const ctx = get2d(composedCanvas);

  ctx.drawImage(posterImage, 0, 0, posterWidth, posterHeight);
  drawCutoutInSlot(ctx, stickerCutout, selectedPoster, posterWidth);

  const dataURL = composedCanvas.toDataURL(mimeType);
  const blob = await canvasToBlob(composedCanvas, mimeType);

  return {
    selectedPosterId: selectedPoster.id,
    selectedPosterName: selectedPoster.name,
    selectedPoster,
    composedCanvas,
    blob,
    dataURL,
  };
}

export function downloadComposedPoster(
  poster: Pick<ComposedPosterResult, "dataURL">,
  filename = "penguin-photo-booth-poster.png",
) {
  const link = document.createElement("a");
  link.href = poster.dataURL;
  link.download = filename;
  link.click();
}
