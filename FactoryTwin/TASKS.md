# Factory Twin — Tasks

Status: `[x]` done, `[ ]` open, `[~]` partial. Updated at the end of every milestone.

## M0 Design
- [x] Inspect environment (Node 22, npm 10, Playwright 1.63 + Chromium preinstalled, no project skills/agents)
- [x] SPEC.md, ARCHITECTURE.md, TASKS.md, TEST_PLAN.md, DECISIONS.md
- [x] `src/simulation/types.ts` shared interfaces, layout, default scenario
- [x] Agent definitions under `.claude/agents/`

## M1 Foundation
- [x] Vite + React + R3F app shell, toolbar, side panels
- [x] Camera: orbit/pan/zoom, top-down, focus, follow, smooth transitions
- [x] Factory floor: zones, aisles, walls, docks, racks, control room, signage, lighting, shadows (3D Engineer subagent)
- [x] Procedural equipment: robot arm, assembly machine, conveyor, inspection gantry, packaging machine, palletizer, AGV, forklift, worker, trucks (`showcase.html`)

## M2 Production simulation
- [x] Event queue, engine, PRNG streams, hashing, event log
- [x] Orders, release/dispatch, products, inventory & suppliers
- [x] Assembly, conveyors, inspection, rework/scrap, packaging, palletizer, FG, shipping
- [x] AGVs, forklift, waypoint routing, point queues
- [x] Workers, shifts, breaks, floater, technician, absences
- [x] Failures (Weibull, preempt-resume), stats trackers
- [x] Headless runner, calibration script (`npm run calibrate`)
- [x] Core tests (invariants 1–10, purity, snapshot NaN, determinism) — 85 tests pass; 30 days ≈ 3 s

## M3 Living factory
- [ ] Playback controller (1x/2x/5x/10x, pause, reset), local + worker host
- [ ] Machines animate from phases; beacons from state
- [ ] Products on belts/buffers/AGVs/pallets via instancing
- [ ] Workers and vehicles follow motion segments
- [ ] Selection, hover tooltip, outline, follow camera

## M4 Dashboard
- [ ] KPI tiles, charts, utilisation, inventory, alerts
- [ ] Inspector panel for every entity kind, product lifecycle
- [ ] Metrics-vs-log test (invariant 9)

## M5 Failures
- [ ] 8 incident types, incident timeline, recovery actions
- [ ] Scenario export/import, replay

## M6 Optimization
- [ ] Parameter editor, baseline save/compare (multi-seed)
- [ ] Bottleneck detector + explanation + test
- [ ] Optimizer in a Web Worker, top 3 recommendations

## M7 Polish & validation
- [ ] Visual polish, perf monitor, draw-call check
- [ ] Three one-click scenarios with numbers
- [ ] Playwright smoke + screenshots in docs/
- [ ] README, final report
