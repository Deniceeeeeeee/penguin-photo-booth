import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Pose = "base" | "wave" | "peace" | "boss" | "love";
export type Effect = "none" | "sparkle" | "heart";

export type GestureResult = {
  name: string;
  score: number;
  landmarks: NormalizedLandmark[] | null;
  recognized: boolean;
};

export type GestureState = {
  pose?: Pose;
  effect?: Effect;
};

export const POSE_CAPTIONS: Record<Pose, string> = {
  base: "Make a gesture",
  wave: "GM mate",
  peace: "Certified Waddler",
  boss: "Grumpy Penguin Mode",
  love: "Penguin loves you",
};

export const EFFECT_CAPTIONS: Record<Effect, string | null> = {
  none: null,
  sparkle: "Waddle Approved",
  heart: "Penguin loves you",
};

export function mapGestureToState(name: string): GestureState | null {
  switch (name) {
    case "Open_Palm":
      return { pose: "wave", effect: "none" };
    case "Victory":
      return { pose: "peace", effect: "none" };
    case "Closed_Fist":
      return { pose: "boss", effect: "none" };
    case "Thumb_Up":
      return { effect: "sparkle" };
    case "ILoveYou":
      return { pose: "love", effect: "heart" };
    default:
      return null;
  }
}

export function getCaption(pose: Pose, effect: Effect) {
  return EFFECT_CAPTIONS[effect] ?? POSE_CAPTIONS[pose];
}

export function getGestureLabel(gesture: GestureResult | null) {
  if (!gesture) {
    return "Ready to pose";
  }

  const prettyName: Record<string, string> = {
    Open_Palm: "Wave Mode",
    Victory: "Peace Mode",
    Closed_Fist: "Grumpy Mode",
    Thumb_Up: "Sparkle Mode",
    ILoveYou: "Love Mode",
  };

  return `${prettyName[gesture.name] ?? gesture.name.replaceAll("_", " ")} ${Math.round(
    gesture.score * 100,
  )}%`;
}

export function getReactionBubble(pose: Pose, effect: Effect) {
  if (effect === "sparkle") {
    return "So shiny!";
  }

  if (effect === "heart" || pose === "love") {
    return "Love u!";
  }

  switch (pose) {
    case "wave":
      return "Hi fren!";
    case "peace":
      return "Yay!";
    case "boss":
      return "Not Today!";
    default:
      return "Cute!";
  }
}
