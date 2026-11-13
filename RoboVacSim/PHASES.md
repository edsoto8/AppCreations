# Implementation phases

Status key: ✅ done and verified · 🟡 done with documented simplification · ⏳ open

## Phase 1: Project foundation ✅

| Criterion | Status | Evidence |
|---|---|---|
| Vite + React + TypeScript strict + ESLint + Vitest + Playwright | ✅ | `package.json`, `tsconfig*.json`, `eslint.config.js`; `npm run check` clean |
| Architecture defined, shared contracts first | ✅ | `src/sim/world/types.ts`, `robotSpec.ts`, `furnitureCatalog.ts`, `GridGeometry.ts`, `render/models/types.ts`, `app/types.ts`, ARCHITECTURE.md |
| Three.js scene + basic UI | ✅ | `render/Stage.ts`, `src/ui` |

## Phase 2: Robot and dock modelling ✅

| Criterion | Status | Evidence |
|---|---|---|
| Detailed original robot with PBR materials and all listed exterior features | ✅ | `render/models/robot/*`: 23 inspectable parts; screenshots in `docs/screenshots` |
| Mechanical animation (wheels by odometry, steering, brushes, mops lower/rotate, LiDAR, bumper, dustbin, suspension, LED states) | ✅ | `RobotView` maps simulation state to `RobotAnimState` |
| Exploded view + transparent inspection + clickable descriptions | ✅ | camera mode 8, x-ray toggle, Inspect tool / clicks |
| Multifunction dock with tanks, bag, wash tray, vents, contacts, display, removable panels, cutaway | ✅ | `render/models/dock/*`: 17 parts |
| Animated service cycle | ✅ | `DockStation` phases drive `DockModel` particles/levels; e2e screenshot `edu-dock-cutaway.png` |

## Phase 3: House environment ✅

| Criterion | Status | Evidence |
|---|---|---|
| Living, kitchen, dining, 2 bedrooms, bathroom, hallways, doorways and thresholds | ✅ | `presets/family.ts` |
| Tile, hardwood, rugs, carpet | ✅ | procedural floor textures in `render/house/textures.ts` |
| Furniture and appliances | ✅ | 25 furniture kinds, 7 obstacle kinds |
| Adjustable wall visibility | ✅ | full / cutaway / hidden |
| Editing: move/rotate, add/remove obstacles, spills, no-go/no-mop zones, room selection, floor types, dynamic obstacle drop, reset | ✅ | `render/interaction/Editor.ts`, `AppController`, Environment panel |
| Presets: apartment, family home, obstacle challenge | ✅ | `presets.test.ts` (43 tests incl. reachability and gap tests) |

## Phase 4: Robotics ✅ (🟡 perfect localisation)

| Criterion | Status | Evidence |
|---|---|---|
| Kinematics + collision handling | ✅ | `RobotBody`; `simcore.test.ts` |
| LiDAR: rotating, range, resolution, noise, point cloud, progressive updates | ✅ | `sensors/Lidar.ts`, `SensorOverlay`; acceptance #1 |
| Occupancy grid; belief vs. truth separated | ✅ | `RobotMap`; acceptance #1 |
| A\* with inflation, dynamic replanning, failed-path handling, stuck recovery | ✅ | `AStar.ts`, `Navigator.ts`; acceptance #2–3, `astar.test.ts` |
| Exploration, coverage, edge cleaning, room-by-room, spot, dock routing | ✅ | `Frontier.ts`, `CoveragePlanner.ts`, `MissionPlanner.ts`, `RobotController.ts` |
| Operating modes with guarded transitions | ✅ | `transitions.ts`; `simcore.test.ts` |
| Localisation | 🟡 | the pose estimate equals the true pose (documented in ROBOTICS.md §1) |

## Phase 5: Cleaning and resources ✅

| Criterion | Status | Evidence |
|---|---|---|
| Spatial dirt (dust, crumbs, hair, liquid, stains, traffic patches, carpet behaviour) | ✅ | `DirtField.ts`; debris particles + heatmap |
| Efficiency by surface, mode, speed, suction, passes, water | ✅ | `simcore.test.ts` (carpet vs hardwood, suction) |
| Battery, power breakdown, charging, water, dustbin | ✅ | `Resources.ts`; tests |
| Low battery → save plan → dock → charge → resume | ✅ | acceptance #7–9 |
| Simulated time only | ✅ | acceptance #11–12 |

## Phase 6: Dashboard and education ✅

| Criterion | Status | Evidence |
|---|---|---|
| Primary controls, mission settings, speed 0.5×–10× (+20×) | ✅ | `MissionPanel`, `TopBar` |
| Live telemetry (all listed values) | ✅ | `Telemetry.tsx`; acceptance #15 |
| Interactive 2D map from simulation state, with all listed layers | ✅ | `ui/map/*` |
| Manual drive and diagnostic modes | ✅ | `ManualPad`, diagnostic checklist |
| Camera modes (9) | ✅ | `CameraRig`; e2e test 4 |
| Engineering mode (9 topics, step-through, live values, in-scene callouts, honest disclaimers) | ✅ | `ui/education/*`, `render/overlays/Labels.ts` |

## Phase 7: Polish and QA ✅

| Criterion | Status | Evidence |
|---|---|---|
| Full missions tested on all presets | ✅ | TESTING.md: headless benchmark table |
| Obstacles and recovery tested | ✅ | acceptance #3, challenge preset run, defect table |
| Performance profiled; quality presets; adaptive governor; perf overlay | ✅ | ~380 draw calls (Low) / ~650 (High incl. shadow pass) for the family home; sim step ~0.5–0.75 ms |
| Production build verified | ✅ | `npm run build` |
| Browser automation with screenshots | ✅ | 5 Playwright tests, `docs/screenshots/` |

## Unresolved issues and next improvements

- ⏳ **Localisation:** add odometry drift plus scan-matching (ICP) or a particle filter, so the map can
  visibly drift and be corrected.
- ⏳ **Coverage** of tight clutter (chair-leg forests, corners) is 84–90 %. Improvements: corner
  wiggle manoeuvres and smaller lane spacing near obstacles.
- ⏳ **Draw calls:** the High preset reaches ~650 for the family home. Merging static furniture into
  per-material batches would roughly halve this.
- ⏳ **Interaction:** room segmentation is user-labelled (from layout rooms), not inferred from the
  map. Doors are open openings only.
- ⏳ **Visuals:** recording a demo GIF/video. No reliable encoder is available in this environment;
  only screenshots were captured.
- ⏳ **Test coverage:** the UI has no component tests; it is exercised by the e2e suite.
