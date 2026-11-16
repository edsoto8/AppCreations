# Factory Twin — Test Plan

## Unit and property tests (Vitest, `npm test`, Node, headless)

| # | Invariant / property | Test file |
|---|---|---|
| 1 | Products follow the station sequence (release → kit → assembly → inspection → [rework → inspection] → packaging → palletize → ship) | `sequence.test.ts` |
| 2 | A machine never processes more than its capacity (1) at once | `capacity.test.ts` |
| 3 | A failed machine produces nothing while down | `failures.test.ts` |
| 4 | Relieving the bottleneck raises output; relieving a non-bottleneck does not (saturated demand) | `bottleneck.test.ts` |
| 5 | Inventory decreases exactly by materials consumed and never goes negative | `inventory.test.ts` |
| 6 | Rejected products get one rework, then scrap; replacement released | `quality.test.ts` |
| 7 | Playback speed (step size) does not change outcomes: identical log hash at 1x and 10x step patterns | `determinism.test.ts` |
| 8 | Same seed + config → identical event log hash; different seed → different hash | `determinism.test.ts` |
| 9 | Dashboard metrics equal values recomputed independently from the event log | `metrics.test.ts` |
| 10 | 30 simulated days headless in < 60 s, unit conservation and invariants hold | `thirtyDay.test.ts` |
| – | Snapshots never contain NaN/Infinity | `snapshot.test.ts` |
| – | Simulation layers import nothing from React/Three/DOM, no `Math.random`/`Date.now` | `purity.test.ts` |
| – | Engine: heap order, tie-break by seq, cancellation | `engine.test.ts` |
| – | PRNG streams independent | `rng.test.ts` |
| – | Calibration: assembly is the top bottleneck at 85–95%; inspection 50–60%; packaging 60–70% | `calibration.test.ts` |
| – | Scenario JSON round trip + replay with injected events reproduces the hash | `scenario.test.ts` |
| – | Every incident kind visibly changes behaviour | `incidents.test.ts` |
| – | Optimizer is deterministic and returns ≤ 3 ranked recommendations | `optimizer.test.ts` |

Unit conservation (checked continuously by `production/invariants.ts` in tests):
`released = inProgress + onPallets(not shipped) + shipped + scrapped` and per material
`initial + received = onHand + consumed + quarantined`.

## UI tests (Playwright, `npm run test:e2e`)

Smoke tests against `vite preview`: app loads, canvas renders (non-blank pixels), play/pause and
speed change the clock, clicking a machine opens the inspector, injecting a failure shows it in
the timeline, dashboard tiles update. Chromium runs with `--use-angle=swiftshader
--enable-unsafe-swiftshader` for headless WebGL.

## Visual verification

`npm run screenshots` captures overview, selected machine, failure state, dashboard and the three
scenarios into `docs/`. Screenshots are inspected by eye (no pixel diffs).
