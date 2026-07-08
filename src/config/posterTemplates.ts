export type PosterTemplate = {
  id: string;
  name: string;
  image: string;
  photoSlot: {
    unit: "px" | "cm";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
};

export const POSTER_WIDTH_CM = 42;

export const posterTemplates = [
  {
    id: "poster-1",
    name: "Poster 1",
    image: "/posters/poster-1.png",
    photoSlot: {
      unit: "px",
      x: 25.3,
      y: 589.8,
      width: 589.8,
      height: 589.8,
      rotation: 0,
    },
  },
  {
    id: "poster-2",
    name: "Poster 2",
    image: "/posters/poster-2.png",
    photoSlot: {
      unit: "px",
      x: 64.7,
      y: 346,
      width: 589.8,
      height: 589.8,
      rotation: 0,
    },
  },
  {
    id: "poster-3",
    name: "Poster 3",
    image: "/posters/poster-3.png",
    photoSlot: {
      unit: "cm",
      x: 3.09,
      y: 11.19,
      width: 15.6,
      height: 15.6,
      rotation: 0,
    },
  },
  {
    id: "poster-4",
    name: "Poster 4",
    image: "/posters/poster-4.png",
    photoSlot: {
      unit: "cm",
      x: 3.57,
      y: 20.45,
      width: 15.6,
      height: 15.6,
      rotation: 0,
    },
  },
] as const satisfies readonly PosterTemplate[];

export type PosterTemplateId = (typeof posterTemplates)[number]["id"];
