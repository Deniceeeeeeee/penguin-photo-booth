# Penguin Photo Booth

A cute webcam-based Penguin Photo Booth built with React, TypeScript, Vite, HTML Canvas, and MediaPipe Gesture Recognizer.

Open the camera, make a supported hand gesture, and the app draws a mirrored square webcam photo with a penguin pose, animated PNG effects, caption text, and a small watermark. Snap the canvas and download the generated PNG.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Vercel Deployment

1. Push the project to a Git repository.
2. Import the repository in Vercel.
3. Use the Vite defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

## Required Assets

These PNG files must exist in `public/assets`:

- `penguin-base.png`
- `penguin-wave.png`
- `penguin-peace.png`
- `penguin-boss.png`
- `penguin-love.png`
- `sparkle.png`
- `heart.png`

V1 intentionally does not use `specs.png`, `sombrero.png`, `scarf.png`, or `body.png`.
