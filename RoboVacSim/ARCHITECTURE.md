# Architecture

```
┌────────────────────────────── browser ──────────────────────────────┐
│  React dashboard (src/ui)          Three.js view (src/render)       │
│   panels · 2D map · education       Stage · CameraRig · HouseView   │
│        ▲  zustand store  │           RobotView/DockView · overlays  │
│        │ (8 Hz telemetry)│ UI state        ▲  reads sim state        │
│        │                 ▼                 │  every frame            │
│   ┌──────────────── AppController (src/app) ──────────────────┐     │
│   │ one rAF loop: sim.advance(realDt) → view.frame(dt)        │     │
│   │ telemetry → store (8 Hz) · store → view (subscriptions)   │     │
│   │ AppApi: commands, editing, reset, speed, camera focus     │     │
│   └──────────────────────────────┬────────────────────────────┘     │
│                                  ▼                                  │
│   Simulation (src/sim) — pure TypeScript, no DOM/three, fixed step  │
└──────────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | Folder | Depends on | Notes |
|---|---|---|---|
| Simulation core | `src/sim` | nothing (no DOM, no three) | deterministic, fixed step, headless-tested |
| Rendering | `src/render` | `src/sim` (read-only), three | never mutates the sim; edits go through `ViewApi` |
| App glue | `src/app` | sim + render + zustand | lifecycle, loop, store bridging |
| Dashboard | `src/ui` | app store + `AppApi` | React; the 2D map reads `api.sim` in its own rAF loop |

### Simulation (`src/sim`)

| Module | Responsibility |
|---|---|
| `core/clock.ts` | `SimClock`: real time × speed → whole fixed steps (20 ms), pause, catch-up cap |
| `core/rng.ts`, `core/events.ts`, `core/math.ts` | seeded RNG, typed emitter, helpers |
| `config.ts` | `SimConfig` + defaults; surface/suction/water factors |
| `world/` | layout types, furniture catalog (shared with render), collision shapes, `WorldModel` (spatial hash, ray casts, collisions, floor/room/cliff grids), presets |
| `robot/` | `robotSpec` (dimensions shared with 3D models), `RobotBody` (diff drive, collisions, bumper, cliff reflex) |
| `sensors/` | `Lidar`, `FrontSensor` (structured light), `WallSensor` (side ToF) |
| `mapping/` | `GridGeometry`, `OccupancyGrid`, `Costmap` (EDT), `RobotMap` (all belief layers + relaxed costmap) |
| `navigation/` | `AStarPlanner`, `Frontier`, `CoveragePlanner` (boustrophedon + edge loops), `PathFollower`, `Navigator` (execution, replanning, recovery) |
| `cleaning/DirtField.ts` | spatial dirt layers, per-pass removal model, pass counting |
| `resources/Resources.ts` | battery energy, power breakdown, charging taper, dustbin, water |
| `dock/DockStation.ts` | dock tanks + service-cycle state machine |
| `mission/` | `types` (modes, missions, commands), `transitions` (guard tables), `MissionPlanner` (regions → tasks), `RobotController` (the behaviour FSM) |
| `Simulation.ts` | orchestrates one step: controller → body → sensors → map → cleaning → resources → dock → animation accumulators; editing API; coverage metrics |
| `telemetry.ts` | `buildTelemetry(sim)`: the plain snapshot the dashboard renders |

Order of one step (20 ms simulated):

1. `ctrl.update`: mode logic, then `Navigator`, which produces (v, ω) and actuator states
2. `body.step`: kinematics, cliff reflex, collision and bumper
3. sensors: LiDAR → occupancy, front sensor → low-obstacle layer, side ToF, floor type
4. `map.update`: throttled costmap rebuild
5. `dirt.clean`: footprint passes → dustbin / recovery tank
6. `res.step`: power, charging
7. `dock.step`: service phases
8. animation accumulators and trajectory, then `clock.tick`

### Rendering (`src/render`)

- **`Stage`:** WebGLRenderer (ACES tone mapping, sRGB), RoomEnvironment PMREM, hemisphere + key
  light with a shadow frustum fitted to the house, optional GTAO (Ultra), and quality presets
  (pixel ratio, shadows, shadow-map size, AO).
- **`CameraRig`:** 9 modes with eased, wall-clock-timed transitions on top of OrbitControls. Tracking
  modes carry the user's orbit offset along with the robot. First-person view is locked to the robot.
- **`house/HouseView`:** procedural floors (CanvasTexture PBR), walls with full/cutaway/hidden modes,
  stairwell, doors and baseboards, and ~25 furniture builders. `sync(layout)` is incremental.
- **`models/robot`, `models/dock`:** procedural PBR models implementing `RobotModel` / `DockModel`.
  They provide inspectable parts, explode / x-ray / cutaway / panel controls, LED and particle effects.
- **`RobotView` / `DockView`:** map simulation state to the animation contracts and smooth the pose at
  low speeds.
- **Overlays:**
  - `DirtOverlay` (data texture: realistic / heatmap / coverage) and `Debris` (instanced crumbs and hair)
  - `SensorOverlay` (point cloud, LiDAR rays, front cone, wall beam, cliff dots)
  - `PlanOverlay` (path, lanes, trail, target, spot)
  - `ZoneOverlay`, `MapOverlay` (robot costmap as a texture)
  - `Labels` (CSS2D room labels and live education callouts)
- **`interaction/Editor`:** raycast picking, drag-to-move, place/remove, zone drawing, spills, spot
  selection and part inspection.
- **`WorldView`:** owns all of the above, maps UI state to visuals, and runs the adaptive performance
  governor.

### App glue (`src/app`)

- `AppController` owns the one `Simulation` and the one `WorldView`, and runs the single
  `requestAnimationFrame` loop.
- Each frame it calls `sim.advance(realDt)`, which runs N fixed steps for N = realDt × speed / 20 ms,
  capped, and then calls `view.frame()`.
- It publishes `buildTelemetry(sim)` and the log to the zustand store at 8 Hz, and perf stats at 2 Hz.
- It subscribes to store changes (camera, overlays, tools, quality …) and forwards them to the view.
- It implements `AppApi` (commands, editing, reset). `reset()` disposes the old simulation and every
  simulation-bound GPU resource, then builds new ones from the preset and seed.
- `AppProvider` creates and disposes the controller inside a React effect (StrictMode-safe) and
  exposes `window.__robovac` / `window.__store` for the e2e tests.

## Key design decisions

- **Simulation and rendering are decoupled.** The sim has zero imports from three/DOM, which is why
  >140 behavioural tests run headless in a few seconds.
- **Fixed step, simulated time everywhere.** Speed 0.5×–20× changes only how many steps run per
  frame. Pause stops stepping entirely, so every subsystem freezes consistently.
- **Visual update rates are separate from simulation rates.** LiDAR visualisation is ≤ 20 Hz (lowered
  by the governor), dirt textures ≤ 10 Hz, map textures ≤ 4 Hz, telemetry 8 Hz, while the
  simulation runs at 50 Hz × speed.
- **Shared contracts:** `robotSpec.ts` (dimensions) and `furnitureCatalog.ts` (leg/base geometry) are
  read by both the physics and the 3D builders, so what you see is what collides.
- **Belief vs. truth** (see ROBOTICS.md §1).

## Performance

- Instancing for debris, screws, bristles, books and vent slats. Geometries and materials are shared
  per furniture kind.
- Preallocated buffers in hot loops: LiDAR rays, A\* arrays, the EDT, overlay attribute arrays and
  data textures.
- Costmap rebuilds are throttled and version-gated. Raster overlays only rebuild when the source
  version changes.
- **Adaptive governor:**
  - When the average frame rate stays below 28 fps for 3 s, it steps the render scale down
    (1 → 0.8 → 0.65 → 0.5) and reduces the sensor visualisation rate.
  - It steps back up after 6 s above 55 fps.
- Quality presets Low / Medium / High / Ultra control pixel ratio, shadows, shadow-map size, GTAO,
  model tessellation and debris counts.
- The perf overlay shows FPS, frame ms, draw calls, triangles, geometries/textures, sim step cost,
  steps per frame and the adaptive level.

## Lifecycle

Every class that creates GPU resources has a `dispose()`. `WorldView.setSimulation` disposes the
previous simulation-bound overlays. `AppController.dispose` cancels the rAF loop and unsubscribes from
the store and the simulation's events. The e2e suite reloads a scenario repeatedly and asserts that
`renderer.info.memory` does not grow.
