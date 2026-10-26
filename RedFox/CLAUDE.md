# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RedFox is a fully procedural, animated 3D red fox viewer: Three.js + TypeScript + Vite. The mesh,
coat, fur, eyes and animations are all generated in code; there are no model or texture files.
`README.md` covers features, controls, architecture and limitations.

## Commands

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # Vitest unit tests (Node, no WebGL)
npm run typecheck   # tsc --noEmit (strict, noUnused*)
npm run build       # typecheck + production build into dist/
npm run preview     # serve dist/ on http://localhost:4173
```

Run all commands from this `RedFox/` folder. Node 22.12+ is required. `.npmrc` sets
`legacy-peer-deps` to dodge an npm 10 crash on Vitest's optional peers; keep it.

## Structure

- `src/fox/` builds the fox. `anatomy.ts` (skeleton + SDF sculpt) → `FoxBuilder.ts` (Surface Nets mesh,
  projection, normals, skin weights, coat via `coat.ts`) runs in `foxWorker.ts`. `FoxModel.ts` turns the
  data into a `SkinnedMesh`, fur shells (`FurMaterial.ts`) and eyes (`Eyes.ts`).
- `src/animation/` is pure pose logic: `states.ts` write `Pose`s, `AnimationController.ts` blends them,
  `FoxRig.ts` applies them to bones (IK, breathing, blinks, ears, tail springs).
- `src/environment/` is the studio, lighting presets, contact shadows and forest. `src/ui/` is plain DOM.
- `FoxBuilder`, `anatomy`, `coat`, `sdf/*`, `Pose`, `states` and `ik` must stay DOM-free so they run in
  the worker and in Vitest.

## Key Conventions

- **Units and axes.** Metres; the fox faces +Z, +Y is up, +X is the fox's left. Every bone has identity
  rotation in the rest pose, so a bone's local axes equal model axes at rest. IK and `aimQuaternion`
  rely on this; keep new bones identity-rotated.
- **Pitch sign.** Positive pitch (rotation about +X) tips a bone's forward end down. For the
  backward-pointing tail that means positive pitch *raises* it; ears tip forward.
- **Legs are goals, not angles.** States set `Pose.legs[*]` (paw position, lower-segment pitch, toe
  pitch, knee pole) and the rig solves IK. Don't write leg bone rotations directly.
- **Head features use `hp()`.** Head coordinates in `anatomy.ts` go through `hp()` (`HEAD_OFFSET`); the
  coat painter subtracts the same offset. Moving the head means changing `HEAD_OFFSET` only.
- **Linear colour.** The coat mixes in linear space, where a few percent of orange turns black into
  brown; give dark masks full strength.
- **Fog vs. tone mapping.** Three.js applies fog after tone mapping, so the backdrop dome skips tone
  mapping to stay identical to the fog colour. Keep that or the horizon line returns.
- **Resources.** Anything that allocates GPU resources needs `dispose()`, reached from `App.dispose()`
  (also called on Vite HMR). Avoid per-frame allocation in the animation path; use module temporaries.

## Visual Checks

Visual changes need a look, not just tests. URL parameters set up a shot: `anim`, `t` (pre-roll
seconds), `cam` (`side|front|back|head|headfront|top|low`), `preset`, `forest=1`, `fur=0`, `wire=1`,
`quality`, `ui=0`, and `shot=1` (no frame loop; drive frames with `window.__fox.step(n)` and grab one with
`window.__fox.capture()`). With headless Chromium use `--use-angle=swiftshader
--enable-unsafe-swiftshader`; prefer `quality=low` and `fur=0` for fast shape checks, and a real page
screenshot (not `capture()`) when judging fur softness.
