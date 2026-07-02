import type { Effect, Pose } from "./gestures";

export type BoothAssets = {
  penguins: Record<Pose, HTMLImageElement>;
  effects: Record<Exclude<Effect, "none">, HTMLImageElement>;
};

const assetPaths = {
  penguins: {
    base: "/assets/penguin-base.png",
    wave: "/assets/penguin-wave.png",
    peace: "/assets/penguin-peace.png",
    boss: "/assets/penguin-boss.png",
    love: "/assets/penguin-love.png",
  },
  effects: {
    sparkle: "/assets/sparkle.png",
    heart: "/assets/heart.png",
  },
} as const;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

export async function loadBoothAssets(): Promise<BoothAssets> {
  const [base, wave, peace, boss, love, sparkle, heart] = await Promise.all([
    loadImage(assetPaths.penguins.base),
    loadImage(assetPaths.penguins.wave),
    loadImage(assetPaths.penguins.peace),
    loadImage(assetPaths.penguins.boss),
    loadImage(assetPaths.penguins.love),
    loadImage(assetPaths.effects.sparkle),
    loadImage(assetPaths.effects.heart),
  ]);

  return {
    penguins: { base, wave, peace, boss, love },
    effects: { sparkle, heart },
  };
}
