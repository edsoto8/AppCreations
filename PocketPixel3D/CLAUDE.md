# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## Project Overview

Pocket Pixel 3D is an interactive 3D retro handheld console (Three.js + TypeScript + Vite) with three
original games on a working 160×144 four-shade LCD. `README.md` covers controls, features and
architecture; `PLAN.md` holds the original plan and milestones.

## Commands

Run from this `PocketPixel3D/` folder.

```bash
npm install
npm run dev                             # http://localhost:5173
npm run typecheck                       # tsc --noEmit (strict; must be clean)
npm test                                # Vitest unit tests
npx vitest run tests/unit/games         # one folder
npm run build                           # typecheck + vite build
npm run e2e                             # Playwright (builds, serves dist on :4173)
npm run screenshots                     # regenerate docs/screenshots (slow in software GL)
```

## Key Architectural Decisions

- **Dependency rule.** `src/games/**` imports nothing outside `src/games` and never Three.js, DOM or Web
  Audio. `src/hardware/**` and `display/BootSequence.ts` are pure too. Only `models/`, `scene/` and
  `display/ScreenTexture.ts` import Three.js.
- **One input path.** Keyboard (`InputManager`), 3D pointer (`InteractionController`) and touch
  (`ScreenOverlay`) all call `ButtonSystem.press/release` with their own source, so one source can't
  release another's press. Taps shorter than a tick are latched.
- **Fixed 60 Hz.** `ConsoleSystem.update(dt)` runs whole ticks (max 8 per frame). Tests and the debug
  API call `step()` directly; never rely on frame rate in tests.
- **One framebuffer.** Games draw shade indices into `FrameBuffer`; `LCDRenderer` produces the 160×144
  canvas that both the 3D texture and the 2D overlay read.
- **Sound is data.** Games emit `SfxSpec` / `MusicTrack` (note-string notation documented in
  `GameInterface.ts`); `AudioManager` synthesises. Device sound is gated by power; mechanical clicks are
  not. The AudioContext is created only in a user gesture.
- **All dimensions live in `models/Layout.ts`** (millimetres, origin at the body centre, +z = front).
- **Animations** use `AnimatedValue` (time-driven, interruptible). The exploded view is one progress
  value with staggered per-part windows.
- **Interaction listeners are registered before OrbitControls** so control gestures can disable
  orbiting and wheel-over-thumbwheel never zooms. Keep that order in `main.ts`.
- **Branding stays original** ("POCKET PIXEL"). Do not add third-party logos, firmware, ROMs, music or
  game art.

## Adding a Cartridge

Implement `Game` (usually by extending `games/common/ArcadeGame.ts`), export a `CartridgeDefinition`
(title, description, controls, label colours + pixel-art rows, `create`), add it to
`games/registry.ts`, and add tests under `tests/unit/games/`. The 3D cartridge, library card and high
score wire up automatically.

## Coding Conventions

- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax` → `import type`).
- Two-space indentation, single quotes, PascalCase classes/files, camelCase members.
- Dispose every Three.js geometry/material/texture you create (models track theirs in sets).
- No per-frame allocations in the render loop; reuse scratch vectors.
- Wrap all `localStorage` access in try/catch and validate what you read (`Settings.sanitizeSettings`).
