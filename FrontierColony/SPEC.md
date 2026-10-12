# Frontier Colony — Application Specification

**Version 1.0 (release, M8).** This document is the authoritative description of what the application
does and how it is built. Gameplay **numbers** are not repeated here: costs, rates, durations,
probabilities, thresholds and goals are defined in `docs/GAME_DESIGN.md`, including its M6 amendments
and the retune recorded in `docs/balance/M6-tuning.md`. They are implemented in `src/sim/balance.ts`.
Engine constants (tick rate, schema version, map sizes, limits) live in `src/sim/constants.ts` and are
quoted here because they shape the architecture.

---

## 1. Product overview

Frontier Colony is a single-player colony simulator for desktop browsers, drawn as an isometric tile world.
Five settlers arrive on a procedurally generated frontier. They look after their own needs, gather resources,
construct buildings and grow the colony **without direct control**.

The player is an overseer:
- places buildings
- sets work priorities
- answers event decisions
- inspects settlers
- manages time

The colony thrives or fails through those choices, the seasons, the weather and random events.

- **Platform:** a modern desktop browser (latest Chrome, Firefox or Safari). There is no backend. Everything
  runs on the client, and games are saved to `localStorage`.
- **Session flow:**
  1. The app boots on the **main menu**, with a paused demo world drawn behind it.
  2. From the menu the player can start a **new game** (seed, layout, size, colony name, difficulty), **load** a
     save, open **How to play** or open **Settings**.
  3. A first game offers a short **coach-mark tour**.
- **Goal:** the *Thriving Frontier* objective (GAME_DESIGN §11) wins the game.
  - Victory shows a statistics screen. **Keep playing** (`acknowledgeVictory`) continues the colony as a sandbox.
  - The colony is **lost** when no settlers remain, whether they died or deserted (GAME_DESIGN §12). This
    stops the simulation.
- **Tech:** TypeScript, React 19, Vite 8, PixiJS 8, Zustand 5, Vitest 5 and Playwright 1.56.
  `npm install && npm run dev` starts it.

---

## 2. Feature requirements

Each requirement has an ID. Section 9 maps every ID to how it is verified.

### 2.1 World

| ID | Requirement |
|---|---|
| W1 | The world is generated from a **seed** string. The same seed and options always give an identical map. |
| W2 | **Terrain types:** deep water, shallow water, sand, grassland, forest, rocky hills and mountain. Each has its own look, walkability, movement cost and buildability. |
| W3 | **Elevation:** integer height levels drawn as raised iso tiles with cliff faces. Mountains are high, and water is drawn at sea level. |
| W4 | **Natural resources:** forests hold wood, and hills and mountains hold stone. Gathering depletes them, and a cleared forest becomes grassland with a stump. Forests regrow and spread outside winter (GAME_DESIGN §6.5). |
| W5 | **Map layouts (presets):** `continent`, `archipelago`, `highlands` and `riverValley`, with the character described in GAME_DESIGN Appendix A. Every start site meets the start guarantees in that appendix. |
| W6 | **Map sizes:** small, medium and large (64², 96² and 128² tiles). |
| W7 | **Day/night cycle.** The day phases (dawn, day, dusk, night) drive ambient lighting, building lights at night and settler schedules. |
| W8 | **Weather:** clear, cloudy, rain, storm and snow, as a seasonal Markov chain (GAME_DESIGN §9). It is shown with particles, tint and cloud shadows, and it affects the simulation (S6). |
| W9 | **Seasons** (spring, summer, autumn, winter) cycle every few days. They change the weather tables, farming (fields lie fallow in winter), growth and the terrain palette. |

### 2.2 Settlers

| ID | Requirement |
|---|---|
| P1 | The colony starts with **5 founders**. Each has a generated **name**, 1–2 **personality traits** from exclusive pairs, and six **skills** (farming, woodcutting, mining, construction, hauling, crafting) on a 0–10 scale. |
| P2 | **Needs** run 0–100, and 100 is best: hunger, energy, happiness and health. Needs drift over time. Traits, weather, season, difficulty and events change the rates. Happiness moves toward a target set by **moodlets**. Statuses (dehydrated, sick) apply their own effects. |
| P3 | **Autonomous behaviour.** Settlers take no direct orders. A utility AI chooses between eating, drinking, sleeping, resting, socializing, wandering, gathering, hauling, constructing and working at buildings (GAME_DESIGN §5). Critical needs interrupt work. |
| P4 | **Pathfinding:** 8-direction A* on the tile grid. It respects walkability and terrain cost, never cuts corners, treats buildings as walls, and rejects unreachable targets early. Settlers re-path when the world changes, for example when a building is placed on their path. |
| P5 | **Activity display:** every settler always has a readable activity label, such as "Chopping wood" or "Walking to Farm". It appears in the inspector, the settler list and the hover card. The renderer animates settlers from `activity.kind`, never from the label. It hides settlers who are inside a building (`activity.indoorsBuildingId`) and draws "zzz" over that building while they sleep. |
| P6 | Skills improve with practice (XP) and scale work speed. Traits change needs, mood, speed and schedules (GAME_DESIGN §3). |
| P7 | Settlers **die** when health reaches 0. The causes are starvation, dehydration, sickness, cold, exhaustion and wolves. Desperately unhappy settlers **desert** the colony. Deaths and departures are logged and announced, and the dead are kept in a graveyard list. |

### 2.3 Resources and economy

| ID | Requirement |
|---|---|
| R1 | Stockpiled resources are **wood, stone, food, water and tools**. **Housing** is a derived capacity: the town center plus completed houses. |
| R2 | Storage capacity is per resource and comes from the town center and storage buildings. Gathering stops at the cap. Goods that still cannot fit (refunds, trades, caches, a cancelled haul) are destroyed, and the loss is reported with a `goodsLost` event and a log line. |
| R3 | **Net production and consumption rates** per in-game day come from hourly history. Each resource shows its rate. One-off construction spending does not distort the rate. |
| R4 | **Consumption:** settlers eat food and drink water. The workshop turns wood and stone into tools. Held tools wear out with work and speed up outdoor jobs. |

### 2.4 Buildings

| ID | Type | Purpose |
|---|---|---|
| B1 | `townCenter` | Pre-placed at the start; there is only one. It holds storage, beds and forage slots, and it is an eating and drinking point. It cannot be demolished. |
| B2 | `house` | Beds. Free beds allow newcomers to arrive. |
| B3 | `farm` | Workers grow food. Output depends on season and weather, and fields lie fallow in winter. |
| B4 | `lumberCamp` | Must be near enough forest. Woodcutters fell trees within its work radius. |
| B5 | `mine` | Must be near hills or mountains. Miners quarry stone within its work radius. |
| B6 | `well` | Workers draw water. It is faster near water. |
| B7 | `storage` | Raises storage capacity, and it is an eating point. It is unlocked by an objective. |
| B8 | `workshop` | Crafts tools from wood and stone. It is unlocked by an objective. |

Every type is defined by a `BuildingDef` (`src/sim/types.ts`), with its values in `BUILDING_DEFS` (`src/sim/balance.ts`). A `BuildingDef` holds:
- footprint and cost
- build work, max builders and max workers
- allowed terrain, and a "near terrain" requirement (`minCount` tiles within a radius)
- work radius, output buffer cap and forage slots
- housing, storage and production
- eating and drinking flags
- the objective that unlocks it (`unlockedBy`)

The design's optional `fishingDock` is **not implemented**.

### 2.5 Simulation

| ID | Requirement |
|---|---|
| S1 | **Production and consumption** run every tick, with rates expressed per in-game hour. Producers fill an output buffer, and haulers carry it to storage. In a famine, buffered food and water can be eaten or drunk straight from the building (GAME_DESIGN §4.1, §5.3). |
| S2 | **Construction.** Placing a building **reserves** its materials. They are not deducted then: affordability uses the stock minus what other sites still need. The site appears as a blueprint. Haulers bring the materials, and builders add work only up to the fraction already delivered. When the site completes it emits `buildingCompleted`. Cancelling refunds delivered materials. Demolishing refunds part of the cost. Damage (storm, wildfire) turns a building back into a **repair** site, which is not cancellable and emits `buildingRepaired` when done. |
| S3 | **Task assignment** respects the player's job priorities (level 0 turns a job off), skills, distance and needs. Targets are reserved: no two settlers gather the same tile, and builder and worker caps hold. |
| S4 | **Population growth comes from newcomers only. There are no births.** A daily check, skipped in winter, admits newcomers when the conditions in GAME_DESIGN §8 hold (free beds, food and water, mood, no recent death, population cap). Wanderers who arrive when there are not enough beds ask to join through a decision. |
| S5 | **Construction and work speed** scale with skill, tools, health, light (day phase), weather and difficulty. |
| S6 | **Weather effects:** rain slows outdoor work and fills rain barrels, snow stops farms, storms drain energy and can damage roofs, and the weather adds mood moodlets (GAME_DESIGN §9). |
| S7 | **Random events:** 14 kinds (GAME_DESIGN §10). Three of them ask the player for a decision: a trader visit, wanderers without beds, and the harvest festival. These are held in `pendingDecisions` with a countdown in game hours, and they are answered with `resolveEvent`. If the window runs out, the decision is declined. Events are seeded and deterministic, and each one is logged and announced. |
| S8 | **Progression, victory and loss.** Ten objectives are tracked at the same time, and two of them unlock building types (GAME_DESIGN §11). Victory needs the first winter survived. A `won` game pauses until the player acknowledges, then continues as a sandbox, and victory never re-triggers. The game is **lost** after any tick with zero settlers. The sim then stops, and the game-over screen shows statistics. |
| S9 | The simulation is **deterministic** and runs on a **fixed timestep**. It is independent of frame rate and speed setting. It uses only IEEE-exact math (CLAUDE.md), and a save/load round trip continues identically. |

### 2.6 Player controls

| ID | Requirement |
|---|---|
| C1 | **Select and inspect settlers.** Click a settler, or choose one in the settler list (sortable and filterable). The inspector shows needs, mood and moodlets, skills and XP, traits, the activity, carried goods, tool durability, home and workplace. It has a "follow" toggle and centres the camera on request. |
| C2 | **Inspect buildings and tiles.** The building inspector shows status, construction or repair progress, delivered materials, workers, residents and output. The hover card shows terrain, resources left, and the building and settlers on a tile. |
| C3 | **Place buildings:** use the build panel or Shift+digit quick-select. A ghost marks each tile valid or invalid, and a placement bar explains why a spot is invalid. Left-click places the building. Right-click or Esc cancels. Locked types are greyed out with their unlock text. |
| C4 | **Cancel construction** and **demolish** completed buildings from the inspector, with a confirmation step. The town center cannot be removed, and a storage building cannot be demolished if doing so would overfill the stock. |
| C5 | **Job priorities** per category (building, farming, woodcutting, mining, hauling, water, crafting), on levels 0–3. |
| C6 | **Pause/resume** with the button or Space. Set the **speed** to 1x, 2x or 4x with the buttons or the keys 1, 2 and 3. |
| C7 | **Save and load.** There are three manual slots and an autosave. The slot list shows colony, day and relative save time. Corrupt or incompatible saves are reported and never crash the app. A damaged autosave falls back to its backup. |
| C8 | **Camera:** drag to pan, use WASD or the arrow keys (Shift for faster), zoom with the wheel or the minimap buttons, click or drag the **minimap** to jump, and the camera is clamped to the map. |
| C9 | **New game** form: seed (random friendly seed by default), layout, size, colony name and difficulty, shown as Easy, Normal and Hard. The `?quickstart` URL flag skips the menu, for dev and e2e use. |
| C10 | **Esc** peels off one layer per press: the game menu, then build mode, then the open panel, then the selection. With nothing left to close, it opens the game menu (resume, save/load, settings, main menu). Panel hotkeys open the build, settlers, priorities, events, stats, save/load, settings and help panels. |

### 2.7 Visual and UX

| ID | Requirement |
|---|---|
| V1 | Isometric tiles with procedural terrain variety, elevation, cliffs, animated water and shore foam, and trees and rocks whose density follows the resource left on each tile. |
| V2 | Each building type has a distinct procedural look. A construction site shows a staked pad, the blueprint, the building rising, scaffolding and material piles. Finished buildings show output piles, chimney smoke and farm growth. |
| V3 | **Animated settlers:** a sprite rig with walk, carry, work swings (chop, mine, build, farm), sit and lie poses. The pose comes from `activity.kind`. Settlers are tinted from their `Appearance`, carry tools and goods, and show activity badges and speech bubbles. |
| V4 | **Smooth camera** with eased pan and zoom and drag inertia. Settler movement is interpolated between ticks. |
| V5 | **Zoom** from 0.3 to 3. When zoomed out, the ground is drawn as baked chunk textures. When zoomed in, it is drawn as live sprites. |
| V6 | **Particles and feedback:** wood chips, stone dust, construction dust, floating "+n" text, falling trees, "zzz" over sleepers, rain, snow, lightning and smoke. |
| V7 | **Construction animation:** the building rises as work progresses, with hammer bursts on `constructionWork`. |
| V8 | **Gathering effects** driven by `SimEvent`s (`resourceGathered`, `resourceProduced`, `tileChanged`). |
| V9 | **Lighting:** day/night ambient light, lit windows and torches at night, golden hour, weather tint, and season palettes that blend over the first day of each season. |
| V10 | **Interface:** attractive panels; a resource bar with rates and tooltips; a warnings strip (GAME_DESIGN §12); an objectives tracker; decision cards with countdowns; toasts that group identical messages and sum gains and losses; an unread badge on the events panel; tooltips on every control; a UI scale preference. |
| V11 | Responsive at 60 fps on a mid-range laptop with a large map and 30 settlers. React re-renders at about 7 Hz at most. |

---

## 3. Architecture

### 3.1 Architecture at a glance

```
                        requestAnimationFrame (one loop, owned by the controller)
                                         │
 ┌───────────────────────────────────────▼───────────────────────────────────────────┐
 │ src/game  GameController                                                           │
 │   frameMs (≤250) × speed ─▶ accumulator ─▶ n × stepGame(state)   [fixed 0.1 s tick]│
 │   alpha = accumulator / TICK_MS                                                    │
 │   owns: GameState (plain JSON)    save/load ─▶ localStorage (envelope + meta + bak)│
 └───┬───────────────┬────────────────────┬─────────────────────────┬─────────────────┘
     │ stepGame /    │ render(state,      │ setSnapshot(           │ subscribe:
     │ applyCommand  │  {alpha, events})  │  buildHudSnapshot)     │ speed, paused,
     ▼               ▼                    ▼  every ~150 ms         │ selection, buildMode,
 ┌─────────┐   ┌──────────────┐   ┌──────────────────┐             │ hoverTile, overlay
 │ src/sim │   │ src/render   │   │ src/store        │◀────────────┘
 │ pure,   │   │ PixiJS v8    │   │ Zustand UiState  │
 │ seeded, │   │ read-only    │   │ + HudSnapshot    │
 │ no DOM  │   │ callbacks ───┼─┐ └────────┬─────────┘
 └─────────┘   └──────────────┘ │          │ useUiStore(selector)
      ▲            pointer: hover/click    ▼
      │              (to controller)  ┌───────────────────────┐
      │                               │ src/ui  React overlay │── commands, save/load,
      │                               │ HUD, panels, menus    │   centerOn, zoomBy ─▶ controller
      │                               └───────────────────────┘
      └── read-only queries (canPlaceBuilding, getTile, …) used by render, store, ui
```

- **`src/sim`**: a pure TypeScript simulation. It has no DOM, React, Pixi, `Math.random`, `Date` or engine-dependent
  math. All game state is one JSON-serializable `GameState`, and `src/sim/index.ts` is the public API.
  Internal modules:
  - `worldgen` and `noise`: world generation
  - `settlerSim`, `needs` and `settlerGen`: settlers
  - `pathfinding` and `grid`: A*, plus region labels cached per world revision
  - `events`: the schedule, random events, decisions, growth, damage and forest regrowth
  - `weather` and `progression`: weather, objectives, unlocks and victory
  - `stateOps`: mutations shared by the modules
  - `queries` and `validate`: read-only queries and save validation
- **`src/render`**: the PixiJS v8 renderer behind the `GameRenderer` interface (section 3.4).
- **`src/store`**: the Zustand UI store (`uiStore.ts`), the snapshot builders (`snapshot.ts`) and player
  preferences (`prefs.ts`).
- **`src/game`**: `GameController` (loop, commands, renderer and store glue, faults), `clock.ts` (the
  fixed-step accumulator), `save.ts` (the storage format) and the React context.
- **`src/ui`**: React components overlaid on the full-viewport canvas (section 3.5). The pure logic lives in
  `src/ui/lib` so it can be unit tested.
- **`src/shared`**: the iso projection maths (`iso.ts`) and the UI-level shared types (`Selection`, `GameSpeed`,
  `OverlayMode`, `PlacementGhost`).

Dependency rules and file ownership are in `CLAUDE.md`.

### 3.2 Game loop

On each `requestAnimationFrame`:

1. Clamp `frameMs` to 250 ms.
2. The game counts as **paused** when any of these holds:
   - `ui.paused` is set (the player, the game menu, the main menu, or a victory that is not yet acknowledged);
   - the controller is **faulted**;
   - `outcome.status === 'lost'`.

   Unless paused, `accumulator += frameMs × speed`.
3. While `accumulator ≥ TICK_MS` (100 ms), run `stepGame(state)` and collect its events, up to 40 ticks per
   frame. Excess time is dropped. The loop stops early within a frame when a tick pauses the store (victory)
   or loses the game.
4. Set `alpha = accumulator / TICK_MS`. Call `renderer.render(state, { alpha, frameMs, nowMs, speed, events })`,
   where `speed` is 0 while paused.
5. If anything changed and 150 ms have passed, publish `buildHudSnapshot(state, selection)` to the store.
   While in build mode, also refresh the placement ghost.
6. Events become toasts. `dayStarted` triggers an autosave. `gameOver` pauses through the store, whether the
   game was won or lost.

**Commands.** These are applied between ticks with `controller.dispatch(command)`.
- On success, the controller handles the events and publishes a snapshot immediately.
- On failure, it raises a warning toast containing the sim's message.

Speed and pause are loop settings in the store. They are not sim commands.

**Faults.** An exception during a tick or a render puts the controller in the faulted state, because the state
may be half-updated:
- the loop stays paused;
- autosave is off;
- a danger toast appears;
- the store's `simHalted` flag drives a persistent banner with a Load button, and disables the speed keys.

Starting a new game or loading a save clears the fault. Separately, a React `ErrorBoundary` catches UI render
crashes and shows a recovery screen. That screen can reload, or clear all `frontierColony.*` data.

### 3.3 Time units

| Unit | Definition |
|---|---|
| tick | One `stepGame` call. `TICKS_PER_SECOND = 10` at 1x. |
| sim second | `TICK_SECONDS = 0.1` per tick. This equals real seconds at 1x, and is used for walking speeds. |
| game hour | `GAME_HOURS_PER_TICK = 24 × TICK_SECONDS / REAL_SECONDS_PER_GAME_DAY`. Used for needs, production, weather and events. The clock is derived from the tick count, so it never drifts. |
| day | Day 1 starts at `START_HOUR`. The day counter increments at midnight, and seasons and years follow from it. |

Each tick runs in this order: clock → weather → schedule (hourly and daily checks, events, growth, objectives) →
settlers → goods-loss reports.

### 3.4 Renderer

`createRenderer(host, callbacks)` initialises a PixiJS v8 `Application` with its ticker stopped, and wraps it in
`IsoRenderer` (`renderer.ts`). The controller drives every frame.

- **Scene graph** (`layers.ts`). These layers sit inside a camera-transformed world container:
  - `ground` (the terrain chunks)
  - `waterFx` (shimmer and foam)
  - `decals`
  - `objects` (depth-sorted)
  - `effects`
  - `overlays`
  - `labels`

  The atmosphere layer is screen-space and sits above the world.
- **Depth sorting** (`depthLayer.ts`, `depthKeys.ts`). The `objects` layer is split into one render group per
  iso diagonal band. A moving settler re-sorts only its own band. Depth keys guarantee that settlers draw over
  their own tile, and that they draw correctly in front of or behind trees, hills and buildings.
- **Terrain** (`terrain/`). `TerrainModel` mirrors the world's tile arrays in typed arrays: visual elevation,
  tree and rock levels, distance to shore, and stumps. Its change detector reports exactly which tiles changed.
  The map is cut into 16×16 chunks. They are built lazily when visible, culled when off-screen, and rebuilt
  only when their own tiles change:
  - a `world.revision` change triggers a structural diff;
  - a `tileChanged` event dirties one chunk.

  **Baking:** when zoomed out (below about 1.45×), each chunk is baked into one `RenderTexture`. That picture
  holds the ground, trees, rocks and raised tiles. When zoomed in, the chunk switches to live sprites.
  Baked objects that must stand in front of a live settler or building are redrawn as **occluders**: only the
  few that overlap the entity and sort after it. The season palette re-bakes the terrain only when a visible
  colour step is crossed.
- **Textures** (`textures/`). All art is procedural: terrain, cliffs, trees, rocks, buildings, settler parts,
  piles and effects. It is drawn once with Canvas 2D, then shelf-packed into atlas pages with mip-maps so
  sprites batch together. There are no image assets.
- **Entities** (`entities/`):
  - building views (art, construction stages, output piles, smoke, farm growth);
  - settler views (a pose-driven sprite rig from `pose.ts`, palettes from `Appearance`);
  - overlays (hover, selection, placement ghost, map overlays).
- **Atmosphere** (`atmosphere/`):
  - `daylight.ts` holds the pure day/night and weather lighting maths. It produces one full-screen multiply
    quad, which is skipped entirely in clear daylight;
  - `lightPoints.ts` places the night lights per building;
  - `seasons.ts` gives the continuous season look;
  - `weatherFx.ts` draws pooled rain, snow, lightning and cloud shadows with hard caps.
- **Effects** (`effects/`). These map `SimEvent`s to pooled particles, floating text and falling trees. Nothing
  is allocated per frame in steady state.
- **Camera and input** (`camera.ts`, `input.ts`):
  - the camera eases toward a target, has drag inertia and is clamped to the map diamond;
  - the input layer handles pointer, wheel, touch and WASD/arrow keys;
  - a press that travels more than a few pixels is a drag, never a click;
  - picking reports exactly one of settler, building or tile, in that priority.

### 3.5 User interface

- **Screens:**
  - **Main menu:** new game, load, how to play, settings, and resume when a game is running.
  - **In-game HUD.**
  - **Game menu** (Esc).
  - **Game-over overlay:** victory shows stats and *Keep playing*; defeat offers load, new game or menu.
- **HUD:**
  - Top bar: clock with day phase and season, weather, resource chips with rates and tooltips, population and beds, speed controls.
  - Warnings strip, placement bar and pause indicator.
  - Left dock: objectives tracker and minimap.
  - Decision cards.
  - Toolbar.
  - Toasts.
  - Hover card.
  - Halted banner.
- **Panels:** build, settlers, priorities, events (log with filters and an unread badge), stats (charts from hourly
  history), save/load, settings and help. Each has a hotkey (`src/ui/lib/hotkeys.ts`). The settler and building
  inspectors open from the selection.
- **Minimap** (`hud/Minimap.tsx`, `lib/minimap.ts`):
  - draws one pixel per tile on a 2D canvas, refreshed at about 20 Hz from `controller.getState()`;
  - rebuilds its base image when `world.revision` changes;
  - shows the camera view as a quad from `controller.getCamera()`;
  - centres the camera on click or drag (`centerOn(tile, { animate: false })` while dragging);
  - has zoom buttons;
  - can be collapsed, which is saved as a pref.
- **Coach-mark tour** (`lib/tour.ts`, `hud/TourHost.tsx`):
  - a short sequence of steps, some completed by doing them (for example, build a farm);
  - offered on the first game, and restartable from Settings;
  - finishing or skipping it sets `prefs.tutorialDone`.
- **Preferences** (`store/prefs.ts`): UI scale (90–125%), autosave on or off, tooltips on or off, tutorial done,
  and minimap open. They are stored under `frontierColony.v1.prefs`. Invalid fields fall back one by one to
  their defaults. `usePrefsSync` writes changes back.
- **Reading game data:**
  - Components read the throttled `HudSnapshot` from the store.
  - A few read the live state on demand through `controller.getState()`, strictly read-only: the minimap, the
    hover card, the placement hint, the stats history, and inspector detail before the next snapshot.
  - No component stores `GameState` in React state or in the store.
- **Debug handle:** `window.__frontierColony` (the controller) is installed only in dev, in `VITE_E2E=1` builds,
  or when the URL contains `?debug`.

---

## 4. Data model (summary of `src/sim/types.ts`)

`src/sim/types.ts` is authoritative. This table summarises it.

| Part | Contents |
|---|---|
| `meta` | `schemaVersion` (2), `seed` (string), `seedNumber` (uint32), `preset`, `mapSize`, `difficulty` |
| `time` | `tick`, `day` (from 1), `timeOfDay` (hours, in [0, 24)), `season` |
| `world` | `width`, `height`, and the flat row-major `number[]` layers `terrain`, `elevation`, `resource` and `building` (an id, or 0). `revision` changes only on **structural** changes: terrain code, elevation or building footprint. Resource depletion arrives as `tileChanged` events and does not bump it. |
| `colony` | `name`, `usedNames` (never reused), `graveyard` (dead settlers with day and cause), `stock`, `priorities` (0–3 per `JobCategory`) |
| `settlers[]` | `id`, `name`, `joinedDay`, `traits`, `skills`, `xp`, `needs`, `moodlets`, `status`, `toolDurability`, `hoursSinceDecision`, `appearance`, `pos` and `prevPos` (continuous tile coordinates; a tile centre is at x + 0.5), `facing`, `path`, `task`, `activity`, `carrying`, `homeId`, `workplaceId`. `status` holds dehydration, sickness, desertion timer, sulking, need alerts, damage log and whether the settler slept outdoors. `task` is sim-internal. `activity` holds `kind`, `label`, `progress`, `targetTile` and `indoorsBuildingId`. |
| `buildings[]` | `id`, `type`, `origin`, `footprint`, `status` (`construction` or `complete`), `construction`, `output` buffer, `productionProgress`, `placedTick`. `construction` holds `kind` (`new` or `repair`), `progress`, `workDone`, `required` (constant total) and `delivered`; it is null when the building is complete. Workers and residents are **not** stored: derive them from `Settler.workplaceId` and `Settler.homeId` with `getWorkers` and `getResidents`. |
| `weather` | `current`, `intensity`, `hoursRemaining` |
| `activeEvents[]` | ongoing random events: `kind`, `hoursRemaining`, `magnitude`, `targetId`, `tile` |
| `pendingDecisions[]` | decisions waiting for the player: `eventId`, `kind` (`traderVisit`, `wanderer` or `harvestFestival`) with a typed `payload`, `hoursLeft`, `windowHours` |
| `eventLog[]` | persisted log lines (severity, message, link to a settler, building or tile), capped at 200 |
| `stats` | hourly `history` (the last 72 samples, each with stock, population, produced and consumed); produced and consumed for the current hour; all-time totals; arrivals, deaths, peak population and buildings completed. `births` is deprecated and always 0. |
| `outcome` | `status` (`playing`, `won` or `lost`), `reason`, `endedTick`. Only `lost` stops the sim. |
| `progress` | `objectivesDone`, `unlocked` building types, `toolsCrafted`, `festivalYear`, `lastDeathTick`, `victoryAcknowledged` |
| `rng` | sfc32 state (`[u32, u32, u32, u32]`) |
| `nextId`, `nextLogId` | id counters |

**Invariants.** `validateGameState` checks types, ranges and references. It rejects NaN, Infinity and
prototype-polluting keys. `assertInvariants` (`src/sim/testSupport.ts`) adds the strict checks used by tests.

- Every tile layer has length `width × height`.
- `world.building` matches each footprint.
- Ids are unique across settlers and buildings, smaller than `nextId`, and every reference points at a live entity.
- `construction` is non-null exactly while the status is `construction`.
- Stock is never negative and never above capacity.
- Needs lie in 0–100.
- `timeOfDay` lies in [0, 24).
- The state round-trips through JSON unchanged.

**Transient events (`SimEvent`)** are returned by `stepGame` and `applyCommand`. They are not stored.

| Group | Events |
|---|---|
| Resources | `resourceGathered`, `resourceDelivered`, `resourceProduced`, `resourceConsumed`, `goodsLost` |
| Buildings | `constructionWork`, `buildingPlaced`, `buildingCompleted`, `buildingDamaged`, `buildingRepaired`, `buildingRemoved` |
| Settlers | `settlerArrived`, `settlerDied`, `settlerLeft`, `needCritical` |
| World | `tileChanged`, `weatherChanged`, `randomEvent`, `dayStarted`, `seasonChanged` |
| Progress | `priorityChanged`, `decisionPending`, `objectiveCompleted`, `buildingUnlocked`, `gameOver` |

`settlerBorn` remains in the union for compatibility but is **never emitted**, because there are no births.
Consumers ignore event types they do not know.

---

## 5. Module contracts

### 5.1 Simulation (`src/sim/index.ts`)

```ts
createGame(options: NewGameOptions): GameState            // deterministic; options are clamped/validated
stepGame(state: GameState): SimEvent[]                   // exactly one tick, mutates state
applyCommand(state: GameState, cmd: PlayerCommand): CommandResult  // never throws; rejected = unchanged
canPlaceBuilding(state, type, x, y): PlacementCheck      // per-tile validity for the ghost + message
validateGameState(value: unknown): ValidationResult      // for loaded saves
// read-only queries (queries.ts):
getTile, getSettler, getBuilding, getBuildingAt, getBuildingDef, getWorkers, getResidents,
getPopulation, getStorageCapacity, getHousingCapacity, getOutstandingMaterials, getAvailableStock,
getResourceRates, getTownReach, inBounds, tileIndex, terrainAt, isTerrainWalkable, footprintTiles,
canAfford, emptyResources, costToAmounts
// also exported: findPath / tileGoal / accessGoal, evaluateStartSite, hashSeed, balance tables
```

**`PlayerCommand`** is one of:

| Command | Fields |
|---|---|
| `placeBuilding` | `buildingType`, `x`, `y` (the footprint origin, its minimum-x and minimum-y corner) |
| `cancelBuilding` | `buildingId` |
| `demolishBuilding` | `buildingId` |
| `setPriority` | `category`, `level` |
| `renameColony` | `name` |
| `resolveEvent` | `eventId`, `accept` |
| `acknowledgeVictory` | none |

**`CommandResult`** is either `{ ok: true, events, entityId }` or `{ ok: false, error: CommandError, message }`.
The `message` is text the player can read.

### 5.2 Renderer (`src/render/types.ts`)

```ts
createRenderer(host: HTMLElement, callbacks: RendererCallbacks): Promise<GameRenderer>
interface GameRenderer {
  setWorld(state); render(state, frame: FrameInfo);        // FrameInfo: alpha, frameMs, nowMs, speed, events
  setPlacementGhost(ghost | null); setSelection(sel | null); setOverlay(mode);
  centerOn(tile, { animate? }); zoomBy(factor); getCamera(): CameraState; destroy();
}
interface RendererCallbacks { onTileHover(tile|null); onTileClick(tile, button);
  onSettlerClick(id, button); onBuildingClick(id, button); }
```

**Iso projection** (`src/shared/iso.ts`):
- 2:1 tiles: `TILE_WIDTH` is 64, `TILE_HEIGHT` is 32 and `ELEVATION_STEP` is 12.
- Helpers: `tileToScreen`, `screenToTile`, `pickTile` (elevation-aware), `isoDepth` and `mapScreenBounds`.

`CameraState` is `{ centerX, centerY, zoom }` in iso world pixels. The zoom range is 0.3–3.

### 5.3 Store (`src/store/uiStore.ts`)

`UiState` fields:

| Group | Fields |
|---|---|
| Screens and menus | `screen` (`mainMenu` or `playing`); `gameStarted` (a real game was started or loaded this page session; it gates autosave and "Resume"); `gameMenuOpen`; `pausedBeforeMenu`; `menuView` (`home`, `newGame` or `load`) |
| Persistent UI | `eventsSeenId` (drives the unread badge); `prefs`; `tourStep` (null when the tour is not running); `simHalted` (set while the controller is faulted) |
| Loop and selection | `speed`; `paused`; `selection`; `buildMode`; `hoverTile`; `overlay` |
| Panels and output | `openPanel` (one of `build`, `settlers`, `priorities`, `events`, `stats`, `saveLoad`, `settings`, `help`); `snapshot`; `toasts` (merged and counted, at most 5) |

Notable actions:
- `showMainMenu`, `enterGame`, `resumeGame`, `openGameMenu` and `closeGameMenu`;
- `pressEscape`, which returns the layer it closed;
- `playAtSpeed`;
- `setPrefs`;
- `startTour`, `setTourStep` and `endTour`;
- `markEventsSeen`;
- `setSimHalted`.

The app instance `uiStore` boots with `screen: 'mainMenu'`, `gameStarted: false` and `paused: true`.

`HudSnapshot` (`snapshot.ts`) holds:
- clock, season, colony name, weather;
- stock, capacity, `reserved` and `available`;
- net rates per day, population, housing, priorities;
- light settler and building summaries;
- active events, the most recent 50 log entries, outcome, pending decisions, progress and stats;
- `selectedSettler` and `selectedBuilding` detail, built only for the current selection.

### 5.4 Controller (`src/game/types.ts`, `controller.ts`)

`GameControllerApi` methods:

| Method | Behaviour |
|---|---|
| `getState()` | Read-only access to the live state. |
| `newGame(options)` | Starts a new game. |
| `dispatch(command)` | Applies a command; a failure also raises a toast. |
| `setSpeed`, `setPaused`, `togglePause` | Write to the store. |
| `saveGame(slot)`, `loadGame(slot)`, `listSaves()`, `deleteSave(slot)` | Saves and loads (section 6). |
| `centerOn(tile, opts?: { animate?: boolean })` | Eases to the tile unless `animate: false`. |
| `zoomBy(factor)` | Changes the zoom. |
| `getCamera()` | Returns `CameraState`, or null before the renderer is mounted. |
| `advanceTicks(n)` | Runs n ticks immediately, regardless of pause. Used for debugging and e2e tests. |

The concrete class adds:
- `mount(host)` and `unmount()`, which are safe under React StrictMode;
- `isFaulted()`, which is true after an error halted the sim.

React gets the controller through `useGameController()`. Screen flow (start, load, resume, to the main menu)
lives in `src/ui/lib/gameFlow.ts`.

Pointer routing:
- In build mode, a left-click places the building and leaves build mode on success. A right-click cancels.
- Otherwise a left-click selects, and a right-click clears the selection.
- In build mode, a click on an entity counts as a click on the tile under it.

---

## 6. Save format and preferences

| Key | Content |
|---|---|
| `frontierColony.v1.save.<slot>` | The save envelope: `{ format: 'frontier-colony-save', schemaVersion, savedAt (ISO), summary, state }`. The slots are `autosave`, `slot1`, `slot2` and `slot3`. |
| `frontierColony.v1.meta.<slot>` | A small summary record `{ format, schemaVersion, savedAt, summary }` used to list slots quickly. It is trusted only if its `savedAt` matches the stored save. Otherwise the list parses the full save. |
| `frontierColony.v1.save.autosave.prev` | A best-effort backup of the previous autosave (one generation). |
| `frontierColony.v1.prefs` | UI preferences (section 3.5). |

- **Schema version 2.** Loading runs these steps:
  1. Parse the JSON.
  2. Check `format`.
  3. Run `migrateEnvelope`. This rejects newer versions and applies **v1→v2**, which adds
     `Activity.indoorsBuildingId = null`.
  4. Run `validateGameState`.
  5. Rebuild the summary from the validated state, because the stored summary is untrusted.

  Every failure is returned as `{ ok: false, error }`. Nothing throws.
- **Saving:**
  - A state that would not load back is refused, and the previous save is kept.
  - The main slot is written first.
  - The backup and the meta record are best effort.
  - On a quota error, the autosave backup is dropped and the write is retried once.
  - A large map saves to about 0.25 MB: 224–245k characters were measured at days 30–46.
- **Loading the autosave:** if the autosave is damaged, the backup is loaded instead, and a warning toast says so.
- **Autosave** runs at each new in-game day and on `pagehide`. It runs only when all of these hold:
  - a game was started or loaded (`gameStarted`), so the demo world behind the menu is never saved;
  - the **Autosave** preference is on;
  - the controller is not faulted;
  - the game is not lost.

  Leaving to the main menu also writes the autosave (`gameFlow.toMainMenu`).
- **Storage fallback:** if `localStorage` is unavailable, an in-memory store is used, and saves last only for
  the page session.

---

## 7. Determinism and testing strategy

**Unit tests** (Vitest, node environment, `tests/**/*.test.ts`):

| Directory | Covers |
|---|---|
| `tests/sim` | RNG, world generation, A* (checked against Dijkstra), settlers, economy, gameplay (weather, events, decisions, growth, victory and loss), commands, validation, the rule that bans engine-dependent math, review regressions, soaks |
| `tests/qa` | Strict invariants over scripted 30-day games, save/load/continue equivalence, junk commands, pace (no victory before the first winter), regressions, soak across every preset × difficulty |
| `tests/game` | The clock, and the save format (migration, backup, meta records, quota) |
| `tests/store` | UI flow, game flow, preferences, toasts, snapshot detail and rates |
| `tests/render` | The pure renderer logic: camera, depth keys, occluder index, poses, terrain model, atmosphere maths |
| `tests/shared` | Iso projection |
| `tests/ui` | The pure UI helpers: formatting, hotkeys, placement text, new game, quickstart, settler info, tooltips, tour, minimap |

**E2E tests** (Playwright, Chromium, `e2e/*.spec.ts`):
- They run against a `VITE_E2E=1` production build in `dist-e2e/`, served by `vite preview`.
- Every test fails on any console error (`e2e/fixtures.ts`).
- They drive the game through `?quickstart`, `data-testid` hooks and `window.__frontierColony`.

---

## 8. Non-functional requirements

- **Startup:** the app starts in under 3 s on a dev machine.
- **Sim cost:** a 30-settler large-map tick takes under 0.5 ms (unit tested).
- **Render cost:** the renderer must hold V11.
- **Build:** strict TypeScript with no errors, and the production build has no warnings. The PixiJS chunk notice
  is silenced by `chunkSizeWarningLimit` in `vite.config.ts`.
- **Accessibility:**
  - every control can be reached with the keyboard where it makes sense (pause, speeds, panels, Esc layers);
  - Space presses a focused button instead of pausing;
  - hotkeys are ignored while the player is typing;
  - text stays readable over the map at every UI scale.

---

## 9. Acceptance criteria and verification

Legend: **unit** = a Vitest file; **e2e** = a Playwright spec; **manual** = a screenshot review
(`docs/screenshots/`) or a hands-on check by the lead or reviewer.

| ID | Verified by |
|---|---|
| W1 | unit `tests/sim/worldgen.test.ts` (determinism), `tests/sim/createGame.test.ts`; e2e `e2e/determinism.spec.ts` |
| W2, W4 | unit `tests/sim/worldgen.test.ts` (tile layers), `tests/sim/settlers.test.ts` (gather depletes forest), `tests/sim/gameplay.test.ts` (forests regrow), `tests/render/terrainModel.test.ts` (stumps, densities) |
| W3 | unit `tests/render/terrainModel.test.ts`, `tests/shared/iso.test.ts`; manual `m6-gfx-hills.png` |
| W5 | unit `tests/sim/worldgen.test.ts` (preset character, terrain shares) |
| W6 | unit `tests/sim/createGame.test.ts` |
| W7 | unit `tests/render/atmosphere.test.ts`, `tests/ui/format.test.ts` (day phases), `tests/sim/settlers.test.ts` (sleep at night); manual `m6-gfx-night.png`, `m6-gfx-dawn.png` |
| W8 | unit `tests/sim/gameplay.test.ts` (weather), `tests/render/atmosphere.test.ts`; manual `m6-gfx-storm.png` |
| W9 | unit `tests/sim/gameplay.test.ts`, `tests/sim/economy.test.ts` (winter fallow), `tests/render/atmosphere.test.ts` (seasonLook); manual `m6-gfx-autumn.png`, `m6-gfx-winter.png` |
| P1 | unit `tests/sim/createGame.test.ts`, `tests/sim/validate.test.ts` |
| P2 | unit `tests/sim/settlers.test.ts`, `tests/store/snapshotDetail.test.ts`; e2e `e2e/autonomy.spec.ts` |
| P3 | unit `tests/sim/settlers.test.ts`, `tests/qa/soak.test.ts`; e2e `e2e/autonomy.spec.ts` |
| P4 | unit `tests/sim/pathfinding.test.ts`, `tests/sim/settlers.test.ts` (step aside and repath) |
| P5 | unit `tests/sim/settlers.test.ts` (labels match kind), `tests/render/pose.test.ts`; e2e `e2e/settlers.spec.ts` |
| P6 | unit `tests/store/snapshotDetail.test.ts` (XP shown); skill growth and trait effects are checked only indirectly (soaks) and by manual play |
| P7 | unit `tests/sim/settlers.test.ts` (survival, desertion), `tests/sim/review.test.ts`, `tests/qa/regressions.test.ts` |
| R1–R4 | unit `tests/sim/economy.test.ts`, `tests/store/snapshotDetail.test.ts` (rates, reserved/available), `tests/sim/review.test.ts` (cap and `goodsLost`), `tests/qa/strictInvariants.test.ts` (ledger) |
| B1–B8 | unit `tests/sim/economy.test.ts` (production buildings), `tests/sim/commands.test.ts`, `tests/ui/placement.test.ts`; e2e `e2e/build.spec.ts`, `e2e/buildings.spec.ts`; manual `m4-gfx-buildings.png` |
| S1, S2, S3, S5 | unit `tests/sim/economy.test.ts` (construction flow, caps, reservations), `tests/sim/settlers.test.ts` (construction and references), `tests/sim/gameplay.test.ts` (priorities, difficulty) |
| S4 | unit `tests/sim/gameplay.test.ts` (population, wanderers) |
| S6 | unit `tests/sim/gameplay.test.ts` (weather effects, storm damage and repair) |
| S7 | unit `tests/sim/gameplay.test.ts` (random events, decisions); e2e `e2e/m5.spec.ts` (trader accept/decline) |
| S8 | unit `tests/sim/gameplay.test.ts` (survival and failure, sandbox), `tests/sim/commands.test.ts`, `tests/qa/paceSoak.test.ts`, `tests/ui/gameplayLib.test.ts` (objectives); e2e `e2e/m5.spec.ts` (colony loss) |
| S9 | unit `tests/sim/createGame.test.ts`, `tests/sim/determinismRules.test.ts`, `tests/qa/saveLoadEquivalence.test.ts`, `tests/sim/settlers.test.ts` (no clock drift), `tests/game/clock.test.ts`; e2e `e2e/speed.spec.ts` |
| C1 | e2e `e2e/settlers.spec.ts`; unit `tests/ui/settlerInfo.test.ts` |
| C2 | e2e `e2e/build.spec.ts` (town center inspector); unit `tests/ui/placement.test.ts` (describeTile) |
| C3 | e2e `e2e/build.spec.ts`; unit `tests/ui/placement.test.ts`, `tests/ui/hotkeys.test.ts` (quick-select) |
| C4 | e2e `e2e/buildings.spec.ts`; unit `tests/sim/settlers.test.ts` |
| C5 | e2e `e2e/m5.spec.ts`; unit `tests/sim/gameplay.test.ts` |
| C6 | e2e `e2e/speed.spec.ts`, `e2e/smoke.spec.ts`; unit `tests/ui/hotkeys.test.ts` |
| C7 | e2e `e2e/saveload.spec.ts`; unit `tests/game/save.test.ts`, `tests/store/gameFlow.test.ts` |
| C8 | unit `tests/render/camera.test.ts`, `tests/ui/tourMinimap.test.ts` (minimap maths); manual (drag, keys, minimap) |
| C9 | e2e `e2e/menu.spec.ts`; unit `tests/ui/newGame.test.ts`, `tests/ui/quickstart.test.ts` |
| C10 | unit `tests/store/uiFlow.test.ts` (pressEscape, game menu), `tests/ui/hotkeys.test.ts` |
| V1–V9 | unit `tests/render/depth.test.ts`, `tests/render/pose.test.ts`, `tests/render/occluders.test.ts`, `tests/render/atmosphere.test.ts`; manual screenshots `m4-gfx-*`, `m6-gfx-*`, `final-*.png` |
| V10 | unit `tests/ui/tooltip.test.ts`, `tests/store/toasts.test.ts`, `tests/ui/gameplayLib.test.ts` (warnings); manual `m6-ui-*.png` |
| V11 | manual. Per the M7 review, this is **not yet measured on real hardware**, only under software GL. |
| Release (M8) | manual: `npm ci && npm run build` on a fresh clone; `npm run typecheck`, `npm test` and `npm run test:e2e` all green |
