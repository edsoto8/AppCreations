# Architecture

A Remotion 4 project. Everything is drawn with React + SVG and driven only by `useCurrentFrame()`,
`interpolate()` and `spring()` — no CSS animations, timers or randomness — so every rendered frame matches
the Studio preview exactly.

```
src/
  index.ts              registerRoot
  Root.tsx              <Composition id="ATMExplainer" 1920×1080 · 30 fps · 1800 frames>
  ATMExplainer.tsx      timeline: "Scenes", "Captions" and "Music" tracks
  theme.ts              colours, fonts, scene timing
  geometry.ts           ATM drawing coordinates, note paths, `along()` path sampler
  fonts.ts              loads bundled Inter / JetBrains Mono from public/fonts
  narration.ts          caption lines + timings (mirrors NARRATION.md)
  components/
    ATMModel.tsx        metallic cabinet (front + oblique side/top), screen, keypad, card & receipt slots,
                        cash slot + shutter, safe door; `frontOpacity` turns the panels into a glass cutaway
    ATMCutaway.tsx      generic dispenser internals: safe, cassettes, pick rollers, transport, sensor,
                        diverter, stacker, presenter belts, reject/retract area, notes in flight
    ATMCamera.tsx       virtual camera (focus point → frame position, zoom, yaw), `toScreen`, `mixCam`
    CashCassette.tsx    removable cassette: notes on edge, pusher plate + spring, handle, denomination tag
    CashRollers.tsx     rotating rubber roller pairs
    BillTransport.tsx   belt path with guide rails, idlers and moving belt dashes
    CashSensor.tsx      emitter/receiver sensor gate with a beam that flashes green (ok) or red (flagged)
    AnimatedBill.tsx    a note seen edge-on, oriented along its travel; StackedNotes for the stacker bundle
    Highlight.tsx       amber glow call-out
    BillFace.tsx        illustrative front-view note, presented bundle, hand silhouette
    WithdrawalScreen.tsx  customer screen UI (menu, amounts, processing, approved, take cash, thanks)
    AuthorizationFlow.tsx ATM → network/processor → issuer bank, blue request/response pulses, approval badge
    CashInventoryDashboard.tsx  cassette counts 500 → 495 and the transaction event record
    AnimatedLabel.tsx   numbered callout with an animated leader line
    SceneHeading.tsx    eyebrow + headline; `Sfx` helper for sound cues
    SceneTransition.tsx fade/scale/blur in and out at scene edges
    Caption.tsx         narration caption (lower third)
    Backdrop.tsx        navy stage, key light, drifting engineering grid, vignette
  scenes/
    cameras.ts          shared camera presets (so adjacent scenes join seamlessly)
    Scene1Intro … Scene7Closing
scripts/
  generate-audio.mjs    synthesises every sound effect and the music bed (original, deterministic)
  stills.mjs            renders review stills (bundles once, renders many frames)
public/
  audio/                generated WAV files + LICENSE.md
  fonts/                Inter + JetBrains Mono + license notices
```

## Key decisions

- **One drawing, many shots.** The ATM is one SVG in its own coordinate space (720 × 1060 units). Scenes move a
  virtual camera (`ATMCamera`) instead of redrawing the machine, so the cutaway, close-ups and front views stay
  consistent. The SVG is laid out at the target pixel size (not bitmap-scaled), so it stays crisp at 2× zoom.
- **Physically coherent note paths.** Notes follow polylines defined in `geometry.ts` (`billPathA`,
  `REJECT_PATH`, presenter path). `along()` samples position and heading, blending the heading at corners so a
  note turns smoothly from vertical (standing in the cassette) to the belt direction.
- **Timing lives on the timeline.** Scenes are `Sequence`s on a named `Track` with explicit `from` /
  `durationInFrames` (editable in Studio). Inside scenes, key frames are named constants (e.g. `FIRST_PICK`,
  `PICK_GAP`, `SHUTTER_OPEN`) and sound cues reference the same constants, so audio stays in sync with motion.
- **Deterministic spinning.** Roller angles integrate a motor-speed curve over frames inside the component, so
  rollers spin up and down smoothly without state.
- **Offline rendering.** No remote images, fonts or audio: fonts and audio ship in `public/`.
- **Educational accuracy.** Authorization (permission, blue) is visually separate from the physical dispense
  (green/amber). The reject path is shown as an example. Labels say the layout is a simplified, generic design.
