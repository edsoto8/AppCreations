# How Cash Works Inside an ATM — Remotion explainer

A 60-second, 1920 × 1080, 30 fps educational animation that follows a $100 withdrawal from the customer's
request, through bank authorization, to five $20 notes being picked, checked, counted, stacked and presented —
and finally the cash inventory and transaction record being updated.

Built with **Remotion 4 + React + TypeScript + SVG**. Every frame is deterministic; all fonts and audio are
bundled, so it renders fully offline. The ATM and its mechanism are a simplified, generic illustration —
real dispensers differ by manufacturer.

**Output:** `output/atm-cash-explainer.mp4` (H.264 + AAC).

## Requirements

- Node.js 20.19+ / 22.13+ (see `engines` in `package.json`)
- On first render Remotion downloads its own headless Chrome. On machines without internet access, pass an
  existing Chromium/Chrome headless shell with `--browser-executable=/path/to/chrome-headless-shell`.

## Commands

```bash
npm install
npm run dev          # Remotion Studio → http://localhost:3000/ATMExplainer (preview, scrub, edit timing)
npm run render       # → output/atm-cash-explainer.mp4
npm run typecheck    # TypeScript check
npm run stills       # review PNGs of key frames → output/stills/
npm run audio        # regenerate the original sound effects + music bed in public/audio/
```

You can also render from Studio's Render button.

## Project files

| Path | What |
|---|---|
| `src/` | Remotion source: composition, scenes, reusable components (see `ARCHITECTURE.md`) |
| `public/audio/` | Original synthesized SFX + music (`scripts/generate-audio.mjs`, see its LICENSE.md) |
| `public/fonts/` | Inter and JetBrains Mono with license notices |
| `STORYBOARD.md` | Scene-by-scene description and timing |
| `NARRATION.md` | Voice-over script with timings (shown as captions in the video) |
| `ARCHITECTURE.md` | Component organisation and design decisions |

## Editing tips

- Scene timing: `src/ATMExplainer.tsx` (one `Sequence` per scene on the "Scenes" track).
- Captions: `src/narration.ts`.
- Colours and fonts: `src/theme.ts`. ATM layout and note paths: `src/geometry.ts`.
- Camera framing per shot: `src/scenes/cameras.ts`.

## Audio & narration

Sound effects and music are original, procedurally synthesized by `scripts/generate-audio.mjs` (no third-party
samples). No text-to-speech service was available when this was built, so narration is presented as on-screen
captions; `NARRATION.md` explains how to drop in a recorded voice-over.

## License notes

Remotion is free for individuals and small teams; companies above the threshold need a company license — see
https://www.remotion.dev/license. Fonts are under their own open licenses (`public/fonts/LICENSE.md`).
