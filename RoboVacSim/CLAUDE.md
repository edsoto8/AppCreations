# CLAUDE.md — RoboVacSim

Ultimate Robot Vacuum: a 3D autonomous-cleaning simulator. Vite 8 + React 19 + zustand + three.js,
TypeScript 6 strict, Vitest, Playwright. Run every command from this folder.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (http://localhost:5173) |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit/integration tests (headless sim) | `npm test` |
| Production build | `npm run build` (then `npm run preview`) |
| Browser e2e (builds first) | `npm run build && npm run e2e` |
| Everything except e2e | `npm run check` |

Dev preview pages for the 3D assets: `/dev/models.html` (robot + dock), `/dev/house.html` (presets).

## Rules

- `src/sim` must stay pure TypeScript: no `three`, no DOM, no `Math.random`, no wall-clock time. All
  randomness comes from `Rng` (seeded); all time from the fixed step. This is what makes the
  acceptance tests deterministic.
- The robot plans only on `RobotMap` (its sensor-built belief). Only physics and sensor models may
  read `WorldModel` (ground truth). Room labels and user zones are the only user-given knowledge.
- Rendering (`src/render`) reads simulation state and never mutates it; edits go through `AppApi`/`ViewApi`.
- Shared physical contracts: `src/sim/robot/robotSpec.ts` and `src/sim/world/furnitureCatalog.ts`
  are used by both physics and 3D builders — change them together.
- Coordinate convention: sim (x, y) metres → three (x, height, y); heading θ → `rotation.y = -θ`.
- Every object that allocates GPU resources needs `dispose()`; reset must not leak (e2e checks it).
- Keep files focused (no monoliths); update `PHASES.md` / `TESTING.md` when behaviour changes.

## Docs

`README.md` (usage), `ARCHITECTURE.md`, `ROBOTICS.md` (algorithms + simplifications), `TESTING.md`,
`PHASES.md` (milestones, status, evidence).
