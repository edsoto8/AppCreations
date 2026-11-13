# Testing

## How to run

```bash
npm test                         # Vitest: unit + integration + acceptance (headless simulation)
npm run build && npm run e2e     # Playwright against the production build (vite preview :4319)
npm run check                    # typecheck + lint + unit tests
```

The simulation in `src/sim` has no DOM or three.js imports and is deterministic for a given layout,
seed and command sequence. The tests therefore drive complete missions headless, typically ~1–3 s of
wall time per simulated 10–30 minutes.

The browser suite runs WebGL on SwiftShader (CPU), so rendering is slow (1–10 fps). It fast-forwards
long simulated periods with the debug hook `window.__robovac.sim.runFor(seconds)`, which runs the same
fixed steps the UI loop would run.

## Latest results

| Suite | Result |
|---|---|
| `npx vitest run` | **11 files, 140 tests passed** (~28 s) |
| `npx playwright test --trace off` | **5 tests passed** (4.1 min, SwiftShader) |
| `npm run build` | passes (`tsc -b` strict + Vite bundle) |
| `npm run lint` | clean |

## Acceptance tests (spec §17) → evidence

All of these are in `tests/unit/acceptance.test.ts` unless noted. They use a two-room test house
(`tests/unit/helpers/testLayout.ts`) so failures are easy to reason about.

| # | Requirement | Test |
|---|---|---|
| 1 | Robot scans and progressively builds a map | *progressive mapping without omniscience*: known area starts at 0 and grows over 60 s of exploration. Room B (behind a wall) is unknown at the start and free at the end. Space outside the exterior walls stays unknown. |
| 2 | Plans and follows an obstacle-free path | *plans and follows…*: A\* from the dock into room B, arrives within 0.25 m with zero bumps |
| 3 | New obstacle → detection + replanning | *detects a newly dropped obstacle*: a box dropped on the route mid-drive. Replans increase, the robot arrives, the body never overlaps the box, and the box appears in the robot's map. |
| 4 | Footprint progressively removes dirt | *removes dirt only under the footprint…*: remaining dirt is monotonically non-increasing, falls below 50 % of initial, and the dustbin plus dock bag equal the removed mass (conservation) |
| 5 | Vacuum vs mop behave differently | *vacuum and mop modes behave differently*: vacuum leaves liquid and stains untouched and removes dust. Mop removes >70 % of the liquid and some stains, uses water, and adds nothing to the dustbin. |
| 6 | Avoids no-go zones | *never enters a no-go zone*: over a full whole-house mission the footprint never overlaps the zone, and zone cells get 0 passes |
| 7 | Low battery → return to dock | *returns to dock on low battery…*: SoC is forced to 19 % mid-coverage. The mode becomes `returning`, the phase `rechargeReturn`, the reason `battery`, and the remaining plan is saved. |
| 8 | Docks and charges | same test: docked within 1 cm of the contacts, mode maintenance/charging, SoC rises |
| 9 | Resumes unfinished cleaning | same test: undocks at ≥ 80 % and resumes `coverage` with the saved task queue (± the trimmed current lane). The mission then completes. |
| 10 | Mission reaches a completed state | *removes dirt…* and *vacuum and mop…*: phase `completed`, robot docked, coverage > 90 % of reachable floor. e2e test 3 completes a mission in the browser. |
| 11 | Pause freezes simulation state | *pausing freezes the full simulation state*: pose, energy, dirt, clock, LiDAR ray count, turret angle, animation accumulators, dock phase and stats are byte-identical after 100 `advance()` calls and `runFor(10)`. e2e test 2 checks the same through the UI buttons. |
| 12 | Speed affects all systems consistently | *simulation speed changes the rate of simulated time, not the physics*: 1000 frames at 1× and 200 frames at 5× give identical step count, pose, energy, dirt and LiDAR rays |
| 13 | Reset gives consistent seeded scenarios | *reset with the same seed reproduces the scenario exactly*: same seed gives identical state after 120 s; a different seed gives different dirt. e2e test 5 checks the same via UI reset. |
| 14 | Resources released on reset/close | unit: `dispose()` drops subscriptions and stops stepping. e2e test 5: the same scenario reloaded 3×, and `renderer.info.memory` geometries/textures do not grow. |
| 15 | Dashboard values agree with simulation | unit: `buildTelemetry()` fields equal the simulation values. e2e test 3: the battery and coverage text shown in the DOM match the simulation after a completed mission. |

## Other automated tests

| File | Covers |
|---|---|
| `occupancyGrid.test.ts` | ray integration (miss/hit), repeated misses clearing, free discs, counts |
| `costmap.test.ts` | inflation distances (inscribed / graded / free), no-go rect blocking, performance |
| `astar.test.ts` | path around walls, sealed map → `noPath`, 0.5 m gap passable vs 0.3 m not, never through INSCRIBED, start-escape, goal tolerance, determinism, < 50 ms on a 16×12 m map |
| `frontier.test.ts` | frontier clustering and reachable targets |
| `coverage.test.ts` | ≥ 90 % lane coverage of a room, lanes on traversable cells, split around a central obstacle, edge paths at safe distance |
| `pathFollower.test.ts` | unicycle follows an L path without overshoot; rotates in place for 180° |
| `simcore.test.ts` | command guards and transition tables (incompatible modes rejected with reasons), clock speed/pause/clamp, battery energy integration (30 Wh at 5 W), suction power, charge taper, full dock service cycle, grid ↔ world round-trip, ray-cast distances and sensor height, collision + bumper, cliff reflex, carpet vs hardwood and suction effects, pass counting |
| `presets.test.ts` | the 3 presets: unique ids, axis-aligned walls, items inside bounds and not in walls, dock approach clear, every room ≥ 40 % reachable (flood fill with 0.18 m inflation), challenge gaps (0.5 m passable, 0.38 m not) |
| `ui-format.test.ts`, `ui-history.test.ts` | dashboard formatting helpers and the sparkline ring buffer |

## Browser tests (`tests/e2e/app.spec.ts`)

1. Loads the dashboard, the 3D view and the 2D map with no console errors; Start is enabled. Screenshot `01-overview.png`.
2. Start → mapping; Pause freezes simulated time and battery; Resume continues; Stop goes to idle. Screenshot `02-mapping.png`.
3. Full apartment mission to completion; the DOM battery/coverage values match the simulation. Screenshot `03-completed-coverage.png`.
4. All 9 camera modes and the education dock cutaway render without errors. Screenshots `cam-*.png`, `edu-dock-cutaway.png`.
5. Adding an obstacle changes the layout; seeded reset is reproducible; GPU memory does not grow.

## Headless whole-home runs (manual benchmark)

`Simulation` was run directly in Node: whole house, Vac + Mop, standard suction, seed 1337.

| Preset | Sim time | Wall time | Coverage of reachable floor | Tasks done / skipped | Dock visits mid-mission |
|---|---|---|---|---|---|
| Simple apartment | 35 min | 30 s | 89.5 % | 102 / 2 | 1 (water) |
| Family home | 2 h 13 min | 155 s | 85.6 % | 255 / 2 | 5 (water + battery) |
| Obstacle challenge | 2 h 00 min | 107 s | 83.8 % | 205 / 3 | 4 |

## Manual test checklist (performed during development)

- [x] Camera modes 1–9 with smooth transitions; orbit, pan and zoom in each.
- [x] Exploded view, x-ray, dustbin lid, dock panels and cutaway; clicking parts shows descriptions.
- [x] Manual drive with WASD; bumper and cliff reflexes stop the robot; vacuum toggle with Space.
- [x] Diagnostic self-test runs 9 checks and reports pass/fail.
- [x] Editor: move/rotate furniture, add/remove obstacles, spill each dirt kind, draw no-go and no-mop zones in 3D and on the 2D map, change floor type, drop an obstacle on the live path.
- [x] Low-battery demo button → return, dock, charge, resume.
- [x] Mobile layout (390 × 844): bottom-sheet tabs, no horizontal overflow.

## Defects found by testing and fixed

| Defect | Found by | Fix |
|---|---|---|
| LiDAR dropouts integrated as max-range "free" rays carved free space through furniture | coverage debug image (lanes inside a cabinet) | dropouts are discarded |
| Exploration stuck forever on unobservable frontiers | headless run (30 min exploring a 28 m² house) | blacklist frontiers that remain after the robot reached them |
| Edge band (10–15 cm) along walls never cleaned | coverage image | side-brush reach, side ToF wall hugging via virtual-pose offset, contact-based path validation |
| Detours chained and skipped wall sections | navigation event trace | rejoin strictly after the blocked segment |
| Lanes in unreachable pockets skipped one by one | family/challenge runs | reachable-region filtering |
| Robot sealed in after a narrow passage (map noise) → "cannot find dock" | challenge run | relaxed-costmap squeeze fallback |
| ~5000 cliff events: in-place rotation swung a rear sensor over the stairwell; backup refused | challenge run trace | refuse rotation too on cliff; rear-cliff recovery moves forward; cliff barrier strip |
| Starting a mission during the post-dock 1.5 s contact phase was rejected | acceptance test | `start` allowed in `maintenance` |
| Viewport inline style broke the absolute layout (black strip) | screenshot | only set `position` when static |
| Perf overlay showed 1 draw call on Ultra (composer reset counters) | perf probe | `info.autoReset = false` + reset per frame |
