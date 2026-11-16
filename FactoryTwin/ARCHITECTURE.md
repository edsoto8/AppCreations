# Factory Twin — Architecture

## Layers

```
src/
  simulation/    engine core: event queue, clock, PRNG streams, hashing, host API, headless runner, types.ts
  entities/      plain data records: Product, Order, Worker, Vehicle, Pallet, resource state trackers
  production/    the factory model: orders, assembly, inspection, packaging, palletizer, conveyors,
                 workforce, failures, incidents, metrics, bottleneck detector, invariants
  logistics/     layout, waypoint graph, motion math, inventory & suppliers, AGV/forklift dispatch, shipping
  optimization/  parameter space, objective, multi-seed evaluation, compare, optimizer
  scenarios/     default config, 3 presets, JSON import/export
  rendering/     React Three Fiber scene: environment, procedural models, sim-state sync
  components/    app shell, toolbar, panels (inspector, incidents, experiments)
  dashboard/     KPI tiles and Recharts charts
  workers/       Web Worker entry points (simulation, optimizer)
  tests/         Vitest suites
```

**Purity rule.** `simulation`, `entities`, `production`, `logistics`, `optimization` import nothing
from React, Three.js, or the DOM, and never call `Math.random`, `Date.now`, `performance.now`.
`src/tests/purity.test.ts` scans these folders and fails the build otherwise.

## Engine

- `EventQueue`: binary heap ordered by `(time, seq)`; `seq` is a global counter so ties break by
  scheduling order. Cancellation is lazy (cancelled ids are skipped).
- `Engine`: `now`, `schedule(at, type, data)`, `cancel(id)`, `on(type, handler)`, `advanceTo(t, maxEvents)`.
  Scheduled events are plain data (`{type, a, b, n}`) dispatched to handlers by type; no closures in the queue.
- Sim time moves **only** when an event is popped. `advanceTo(t)` processes every event with time ≤ t;
  it does not move the clock without an event. The renderer keeps its own `renderTime` and
  evaluates motion segments at that time.
- `Rng`: mulberry32. `rng.stream(name)` derives an independent generator from `hash(seed, name)`.
  Streams: `arrivals`, `quality`, `absence`, `supply`, `carrier`, `proc:<station>`, `fail:<resource>`.
  Adding a draw in one stream never shifts another.
- `EventLog`: domain records (`LogRecord`) appended by the model; a rolling FNV-1a 64-bit hash is
  kept always, the full array only when `keepLog` is on (tests, short runs).

## Factory model

`production/factory.ts` builds a `Factory` from a `Scenario`: layout, entities, subsystems, initial
events (shift starts, first order arrival, initial backlog, metric sampling, injected events).
Subsystems share a `Ctx` (engine, config, layout, rng, log, stats) and call each other through
narrow methods (`notifyKitDelivered`, `pullFromC1`, ...). Pull/push between stations uses explicit
`tryAccept` / `pull` calls so blocking and starving are modelled exactly.

Key rules:
- Assembly cycle = robot load → process → robot unload → push to C1. A failure pauses the phase
  (remaining time kept) and resumes after repair. Failures are sampled on busy time (Weibull
  residual life), so idle machines do not wear.
- Conveyors are accumulating belts: each item stores `(basePos, baseBelt)`; position =
  `min(basePos + beltPos − baseBelt, positionOfItemAhead − pitch)`. Only the head's arrival is
  scheduled; on hand-off the remaining items are rebased.
- Vehicles move along waypoint-graph paths (`MotionSegment`); pick-up/drop-off points have
  capacity 1 with FIFO queues. A breakdown mid-path freezes the vehicle at the interpolated
  position; the remainder resumes after repair.

## State flow to the UI

```
          ┌───────────── SimHost (LocalSimHost | WorkerSimHost) ─────────────┐
 rAF  ──► │ PlaybackController.frame(dtWall): target = renderTime + speed*dt  │
          │   (capped at maxSimSecPerFrame and maxEventsPerFrame)            │
          │ host.advanceTo(target) ─► engine processes events               │
          │ host.snapshot  (rebuilt only when engine.version changed)       │
          └──────────────────────────────────────────────────────────────────┘
 useFrame reads simRef.current.snapshot + renderTime → writes Object3D/instance matrices directly
 setInterval(250 ms wall) → host.metrics → Zustand `dashboard` slice (≤ 4 updates/s)
 Zustand: selection, hover, camera mode, panel state, playback (speed, paused), dashboard samples
```

No per-tick simulation data flows through React renders. Motion is analytic (segments with
`t0/t1`), so the worker host's one-frame snapshot latency does not cause stutter.

## Snapshot format

See `SimSnapshot` in `src/simulation/types.ts`: stations (state, phase), conveyors (belt odometer
+ items), buffers, vehicles and workers (position + optional motion segment), products (location
reference, not coordinates), pallets, trucks, inventory, active incidents. Product world positions
are resolved in the renderer from location + layout.

## Headless

`simulation/runner.ts` runs a scenario for N days with no rendering (Node or worker). Used by the
optimizer, compare tool, calibration script, scenario report and the 30-day test.

## Performance budget

| Item | Budget |
|---|---|
| Frame rate | 60 fps at default settings and 10x on an M1 MacBook Pro |
| Draw calls | ≤ 400 per frame including the shadow pass (shown in the perf monitor) |
| Triangles | ≤ 1.5 M |
| Sim work per frame | ≤ 5,000 events and ≤ 120 sim-seconds per frame; excess is deferred |
| Dashboard updates | ≤ 4 React updates/s |

Techniques: instanced meshes for products, belt rollers, rack slots, pallets, cartons and floor
markings; shared geometries/materials from `rendering/materials.ts`; one shadow-casting
directional light with a fitted frustum; no per-frame allocations in `useFrame`.

## File ownership map

| Area | Owner | Files |
|---|---|---|
| Contracts & docs | Architect (main session) | `src/simulation/types.ts`, `*.md`, `src/scenarios/**` |
| Simulation | Simulation Engineer (main session) | `src/simulation/**`, `src/entities/**`, `src/production/**`, `src/logistics/**` |
| Procedural models & environment | 3D Engineer | `src/rendering/models/**`, `src/rendering/environment/**` |
| Scene sync, camera, selection | Architect | `src/rendering/*.tsx|ts` (top level) |
| App shell & panels | Frontend Engineer / Architect | `src/components/**`, `src/App.tsx`, `src/main.tsx`, `src/store.ts` |
| Dashboard | Frontend Engineer | `src/dashboard/**` |
| Optimisation | Optimization Engineer | `src/optimization/**`, `src/workers/optimizer.worker.ts` |
| Tests | QA Engineer | `src/tests/**`, `e2e/**`, `scripts/screenshots.mjs` |
| Review | Architecture Reviewer | read-only |

Agents only edit files in their area; cross-area changes go through the architect.
