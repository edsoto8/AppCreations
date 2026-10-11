# Frontier Colony — Application Specification

Version 1.0 (M1 Foundation). This is the authoritative specification of what the application does and
how it is built. Gameplay **numbers** (costs, rates, durations, probabilities, thresholds) are defined
in `docs/GAME_DESIGN.md` and implemented in `src/sim/balance.ts`. This document does not repeat them.

---

## 1. Product overview

Frontier Colony is a single-player colony simulator. It runs in a desktop browser and is drawn as an
isometric tile world. A handful of settlers arrive on a procedurally generated frontier. They look after
their own needs, gather resources, construct buildings and grow the colony **without direct control**.
The player acts as an overseer: they place buildings, set work priorities, inspect settlers and manage time.
The colony thrives or fails because of these decisions, the weather and random events.

- **Platform:** a modern desktop browser (latest Chrome, Firefox or Safari). It has no backend, and
  everything runs on the client.
- **Session:** start a new game (seed, map layout, size, colony name, difficulty), or continue from a save.
- **Win / lose:** there is a survival goal, or the colony is lost when all settlers die. The exact
  conditions are in GAME_DESIGN.md.
- **Tech:** TypeScript, React, Vite, PixiJS v8, Zustand, Vitest, Playwright, and localStorage for saves.
  `npm install && npm run dev` starts it.

---

## 2. Feature requirements

Each requirement has an ID that sections 9 (acceptance criteria) and the test suite refer to.

### 2.1 World

| ID | Requirement |
|---|---|
| W1 | Procedural world generated from a **seed** string. The same seed and options always give the identical map. |
| W2 | Terrain types are deep water, shallow water, sand, grassland, forest, rocky hills and mountain. Each has its own look, walkability, movement cost and buildability. |
| W3 | Elevation: integer height levels drawn as raised iso tiles. Mountains are high, and water is low. |
| W4 | Natural resources: forests hold wood, and hills and mountains hold stone. They are depleted by gathering. A cleared forest becomes grassland. |
| W5 | **Multiple map layouts (presets):** `continent` (one large landmass with a coast), `archipelago` (islands joined by shallows), `highlands` (hilly with mountain ranges), and `riverValley` (a river through a fertile valley). |
| W6 | Map sizes small, medium and large (64², 96² and 128² tiles). |
| W7 | **Day/night cycle.** Time of day drives the lighting, with dawn, day, dusk and night, and settler schedules (sleeping at night). |
| W8 | **Weather:** clear, cloudy, rain, storm and snow. Snow happens only in cold seasons. Weather changes over time, is shown visually (particles and tint), and affects the simulation (see S6). |
| W9 | Seasons (spring, summer, autumn and winter) cycle every N days and affect weather odds and farming. |

### 2.2 Settlers

| ID | Requirement |
|---|---|
| P1 | The colony starts with **5 settlers**, each with a generated **name**, 1–2 **personality traits** (from exclusive pairs) and **skills** (farming, woodcutting, mining, construction, hauling, crafting; 0–10). |
| P2 | **Needs** (0–100, where 100 is best): hunger, energy, happiness and health. Needs drift over time. Traits, weather and events change how fast. Happiness moves toward a target set by **moodlets**, and statuses (dehydrated, sick) apply effects. |
| P3 | **Autonomous behaviour**, with no direct orders: settlers choose tasks with a utility or priority system. The tasks are eating, drinking, sleeping or resting, gathering, hauling, constructing, working at production buildings and socialising. Urgent needs override work. |
| P4 | **Pathfinding:** A* on the tile grid that respects walkability and terrain cost, and walks around obstacles (water, mountains, buildings). Settlers re-path when the world changes. |
| P5 | **Activity display:** every settler always has a readable activity label, such as "Chopping wood", "Walking to Farm" or "Sleeping at home". It is shown in the inspector and the settler list, and the label also determines the animation. |
| P6 | Skills improve with practice and change work speed. Traits change needs, mood and speed (see GAME_DESIGN.md). |
| P7 | Settlers die when health reaches 0, from starvation, sickness or exposure. A death is logged and announced. |

### 2.3 Resources and economy

| ID | Requirement |
|---|---|
| R1 | Stockpiled resources are **wood, stone, food, water and tools**. **Housing** is a derived capacity (the sum of completed houses and the town center). |
| R2 | Each resource has a storage capacity that comes from the town center and storage buildings. Production stops when storage is full. |
| R3 | **Production and consumption rates** (net per in-game day) are computed from hourly history and shown next to each resource. |
| R4 | Consumption: settlers eat food and drink water. The workshop consumes wood and stone to make tools. Tools wear out with work. |

### 2.4 Buildings

| ID | Type | Purpose |
|---|---|---|
| B1 | `townCenter` | Pre-placed at the start, and the only one. Holds storage, houses some of the founders, and is where settlers eat and drink. It cannot be demolished. |
| B2 | `house` | Housing. Free housing allows population growth. |
| B3 | `farm` | Workers grow food. Output depends on season and weather. |
| B4 | `lumberCamp` | Must be near forest. Woodcutters fell trees in range and haul the wood back. |
| B5 | `mine` | Must be near hills or mountains. Miners quarry stone. |
| B6 | `well` | Workers draw water. |
| B7 | `storage` | Raises storage capacity. |
| B8 | `workshop` | Crafts tools from wood and stone. |

Every type has a footprint, a cost, build work, allowed terrain, an optional "near terrain" requirement
(at least `minCount` tiles within a radius), a worker limit, housing, storage or production values,
an `eatingPoint` flag, and the objective that unlocks it (`unlockedBy`). The shape is `BuildingDef` in `src/sim/types.ts`,
and the values are in `BUILDING_DEFS` in `src/sim/balance.ts`.

### 2.5 Simulation

| ID | Requirement |
|---|---|
| S1 | **Production and consumption** run each tick, on in-game hour scales. |
| S2 | **Construction:** a placed building becomes a construction site. Haulers bring materials from storage, and builders add work. The site completes when the materials are delivered and the work reaches `buildHours`. The construction progress is shown visually. Cancelling refunds the delivered materials. |
| S3 | **Task assignment** respects the player's job priorities, settler skills, distance and needs. One settler cannot claim the same target (tree, work slot) as another. |
| S4 | **Population growth:** when food, water, housing and happiness conditions hold, new settlers are born or arrive (as wanderers). |
| S5 | **Construction times** scale with builder skill, tools and weather. |
| S6 | **Weather effects:** for example, rain helps farms and slows walking, storms stop outdoor work and hurt happiness, and snow slows everything and raises food needs. |
| S7 | **Random events** (some ask for a player decision, which is held in `pendingDecisions` and answered with `resolveEvent`), for example a wanderer joining, a bountiful harvest, crop blight, drought, sickness, wildfire, tools breaking, a cold snap or a trader visit. They are seeded and deterministic, logged and announced. |
| S8 | **Survival and failure:** the game is lost when no settlers remain, and the simulation then stops. It is won by meeting the goal in GAME_DESIGN.md. Victory shows a screen with statistics, and after `acknowledgeVictory` the colony continues as a sandbox. **Objectives** unlock building types in sequence (`progress.unlocked`). |
| S9 | The simulation is **deterministic**, uses a **fixed timestep**, and is independent of frame rate and speed setting. |

### 2.6 Player controls

| ID | Requirement |
|---|---|
| C1 | **Select and inspect settlers.** Clicking one, or choosing it in the settler list, shows name, traits, skills, needs bars, activity, carried item, home and workplace. A button centres the camera on the settler. |
| C2 | **Inspect buildings and tiles** (type, status, progress, workers, residents, output; terrain, resource left). |
| C3 | **Place buildings:** choose from the build menu, see a ghost that shows valid and invalid tiles, left-click to place and right-click or Esc to cancel. Invalid placement explains why (toast or tooltip). |
| C4 | **Cancel construction and demolish** completed buildings (except the town center). |
| C5 | **Job priorities** per category (building, farming, woodcutting, mining, hauling, water, crafting) on levels 0–3, where 0 disables the category. |
| C6 | **Pause/resume** (button and Space) and **speed** 1x, 2x and 4x (buttons and keys 1, 2 and 3). |
| C7 | **Save/load:** manual slots and autosave in localStorage. A slot list shows the colony name, day and save time. Corrupt or incompatible saves are reported and never crash the game. |
| C8 | **Camera:** drag to pan (and use the arrow or WASD keys), zoom with the wheel or the +/- buttons, and limit the camera to the map. |
| C9 | **New game** screen with seed (random by default), layout preset, size, colony name and difficulty. |

### 2.7 Visual and UX

| ID | Requirement |
|---|---|
| V1 | Isometric tiles with terrain variety, elevation, and trees and rocks on resource tiles. |
| V2 | A visually distinct look for each building type, and a look for the construction site. |
| V3 | **Animated settlers:** walking, working (chopping, mining, building, farming), carrying and sleeping, chosen from `activity.kind`. |
| V4 | **Smooth camera** (eased pan and zoom), and settler movement interpolated between ticks. |
| V5 | **Zoom** across a useful range, with crisp rendering. |
| V6 | **Particles:** wood chips, stone dust, construction dust, rain and snow, and smoke from the chimney or workshop. |
| V7 | **Construction animation** (scaffolding or rising build progress, builders hammering). |
| V8 | **Gathering animations and effects** that come from `SimEvent`s (`resourceGathered`, `constructionWork`). |
| V9 | Day/night lighting tint and weather tint. |
| V10 | Attractive panels (resource bar with rates, settler list, inspector, build menu, priorities, event log, save/load), **tooltips** on every control and resource, and **feedback** for every action (toasts, sounds optional, hover highlight, selection outline). |
| V11 | It stays responsive at 60 fps on a mid-range laptop with a large map and 30 or more settlers. React re-renders at about 7 Hz at most. |

---

## 3. Architecture

```
               ┌─────────────── src/ui (React) ────────────────┐
  user input → │ HUD, panels, menus  ── reads ─▶ store (Zustand)│
               │        │ commands / save / load                │
               └────────┼───────────────────────────────────────┘
                        ▼
               src/game GameController ── owns ─▶ GameState (plain JSON)
                 │  rAF loop, fixed ticks × speed      ▲
                 │  applyCommand / stepGame ───────────┘ src/sim (pure, deterministic)
                 │  render(state, frame) ─▶ src/render (PixiJS v8, read-only)
                 │  snapshot every ~150 ms ─▶ store.snapshot
                 └  save/load ─▶ localStorage (versioned envelope)
```

- **`src/sim`** is a pure TypeScript simulation. It has no DOM, React, Pixi, `Math.random` or `Date`. All the
  game state lives in one JSON-serializable `GameState`. The public API is `src/sim/index.ts`.
- **`src/render`** is a PixiJS v8 renderer behind the `GameRenderer` interface. It reads the state,
  interpolates movement, plays effects from events, and turns pointer input into callbacks.
- **`src/store`** is a Zustand store for UI state, plus `buildHudSnapshot()`. The snapshot is a detached copy
  of what the UI shows, published by the controller at a throttled rate.
- **`src/game`** is the `GameController`. It owns the loop and the state, routes renderer callbacks to the sim
  and the store, forwards store intent to the renderer, and handles save/load and autosave.
- **`src/ui`** holds the React components overlaid on the full-viewport canvas.
- **`src/shared`** holds the iso projection math and the UI-level shared types.

The dependency rules and file ownership are in `CLAUDE.md`.

### 3.1 Game loop

1. On each `requestAnimationFrame`, `frameMs` is clamped to 250 ms, and `accumulator += frameMs × speed`
   unless the game is paused or over.
2. While `accumulator ≥ TICK_MS` (100 ms): `stepGame(state)`, collect the events. This runs at most
   40 ticks per frame, and any excess is dropped.
3. `alpha = accumulator / TICK_MS`, then `renderer.render(state, { alpha, frameMs, nowMs, speed, events })`.
4. If anything changed and 150 ms have passed, the controller publishes `buildHudSnapshot(state)` to the store.
5. Events are turned into toasts. `dayStarted` triggers an autosave, and `gameOver` pauses the game.

Commands are applied between ticks, through `controller.dispatch(command)`. Speed (1x, 2x, 4x) and
pause are loop settings in the store, not sim commands.

### 3.2 Time units

| Unit | Definition |
|---|---|
| tick | One `stepGame` call. `TICKS_PER_SECOND = 10` at 1x (`src/sim/constants.ts`). |
| sim second | `TICK_SECONDS = 0.1` per tick. This equals real seconds at 1x. Used for movement speeds. |
| game hour | `GAME_HOURS_PER_TICK = 24 × TICK_SECONDS / REAL_SECONDS_PER_GAME_DAY`. Used for needs, production and weather. |
| day | Starts at `START_HOUR` on day 1. The day counter increments at midnight. |

---

## 4. Data model (summary of `src/sim/types.ts`)

`src/sim/types.ts` is the authoritative definition. This section gives an overview.

| Part | Contents |
|---|---|
| `meta` | `schemaVersion`, `seed` (string), `seedNumber` (uint32), `preset`, `mapSize`, `difficulty` |
| `time` | `tick`, `day` (from 1), `timeOfDay` (hours, 0 to under 24), `season` |
| `world` | `width`, `height`, and the flat row-major `number[]` layers `terrain`, `elevation`, `resource` and `building` (an id, or 0). `revision` changes whenever any tile changes. |
| `colony` | `name`, `stock: ResourceAmounts`, `priorities: Record<JobCategory, 0-3>` |
| `settlers[]` | `id`, `name`, `joinedDay`, `traits`, `skills`, `xp`, `needs`, `moodlets`, `status` (dehydrated, sickness, desertion and other counters), `toolDurability`, `appearance`, `pos`/`prevPos` (continuous tile coordinates; a tile centre is `x + 0.5`), `facing`, `path`, `task` (internal to the sim), `activity` (`kind`, `label`, `progress`, `targetTile`), `carrying`, `homeId`, `workplaceId` |
| `buildings[]` | `id`, `type`, `origin`, `footprint`, `status` (`construction` or `complete`), `construction` (progress, workDone, required, delivered; null when complete), `workerIds`, `residentIds`, `output`, `productionProgress`, `placedTick` |
| `weather` | `current` (WeatherKind), `intensity`, `hoursRemaining` |
| `activeEvents[]` | ongoing random events (`kind`, `hoursRemaining`, `magnitude`) |
| `eventLog[]` | persisted log lines (severity, message, links to a settler, building or tile), capped at 200 |
| `stats` | hourly `history` samples (the last 72), per-hour and total production and consumption, births, arrivals, deaths, peak population, buildings completed |
| `outcome` | `status` (`playing`, `won` or `lost`), `reason`, `endedTick`. Only `lost` stops the sim. |
| `pendingDecisions[]` | events waiting for the player (`eventId`, `kind`, `payload`, `hoursLeft`) |
| `progress` | `objectivesDone`, `unlocked` building types, `toolsCrafted`, `festivalYear`, `lastDeathTick`, `victoryAcknowledged` |
| `rng` | sfc32 state (`[u32, u32, u32, u32]`) |
| `nextId`, `nextLogId` | id counters |

**Invariants** (the sim keeps them, and `validateGameState` checks the structural ones):

- Every tile layer has length `width × height`.
- `world.building[i]` is the id of the building whose footprint covers tile `i`, or 0.
- Ids are unique across settlers and buildings, and smaller than `nextId`.
- `building.construction` is non-null exactly when `status === 'construction'`.
- Stock is never negative.
- Needs are between 0 and 100.
- `timeOfDay` is in the range 0 to under 24.
- The state round-trips through JSON unchanged.

**Transient events (`SimEvent`)** are returned by `stepGame` and `applyCommand`, and they are not stored.
The resource events are `resourceGathered`, `resourceDelivered`, `resourceProduced` and `resourceConsumed`.
The building events are `constructionWork`, `buildingPlaced`, `buildingCompleted` and `buildingRemoved`.
The settler events are `settlerBorn`, `settlerArrived`, `settlerDied`, `settlerLeft` and `needCritical`.
The world events are `tileChanged`, `weatherChanged`, `randomEvent`, `dayStarted` and `seasonChanged`.
The remaining events are `priorityChanged`, `decisionPending`, `objectiveCompleted`, `buildingUnlocked` and `gameOver`. Consumers ignore event types they do not know.

---

## 5. Module contracts

### 5.1 Simulation (`src/sim/index.ts`)

```ts
createGame(options: NewGameOptions): GameState            // deterministic
stepGame(state: GameState): SimEvent[]                   // exactly one tick, mutates state
applyCommand(state: GameState, cmd: PlayerCommand): CommandResult  // never throws
canPlaceBuilding(state, type, x, y): PlacementCheck      // per-tile validity for the ghost
validateGameState(value: unknown): ValidationResult      // for loaded saves
// read-only queries:
getTile, getSettler, getBuilding, getBuildingAt, getBuildingDef, getPopulation,
getStorageCapacity, getHousingCapacity, getResourceRates, inBounds, tileIndex,
terrainAt, isTerrainWalkable, footprintTiles, canAfford, emptyResources, costToAmounts
```

`PlayerCommand` can be `placeBuilding {buildingType, x, y}` (the footprint origin is the minimum-x,
minimum-y corner), `cancelBuilding {buildingId}`, `demolishBuilding {buildingId}`, `setPriority {category, level}`,
`renameColony {name}`, `resolveEvent {eventId, accept}` or `acknowledgeVictory`. `CommandResult` is either `{ ok: true, events, entityId }` or
`{ ok: false, error: CommandError, message }`, where `message` is text the player can read.

### 5.2 Renderer (`src/render/types.ts`)

```ts
createRenderer(host: HTMLElement, callbacks: RendererCallbacks): Promise<GameRenderer>
interface GameRenderer {
  setWorld(state); render(state, frame: FrameInfo);
  setPlacementGhost(ghost | null); setSelection(sel | null); setOverlay(mode);
  centerOn(tile, {animate?}); zoomBy(factor); getCamera(); destroy();
}
interface RendererCallbacks { onTileHover(tile|null); onTileClick(tile, button);
  onSettlerClick(id, button); onBuildingClick(id, button); }
```

The iso projection is the 2:1 projection in `src/shared/iso.ts`: `TILE_WIDTH` is 64, `TILE_HEIGHT` is 32
and `ELEVATION_STEP` is 12. It provides `tileToScreen`, `screenToTile`, `pickTile` (aware of elevation)
and `isoDepth`.

### 5.3 Store (`src/store`)

`UiState` holds `screen`, `speed`, `paused`, `selection`, `buildMode`, `hoverTile`, `overlay`,
`openPanel`, `snapshot: HudSnapshot | null` and `toasts`. Each field has an action. `HudSnapshot` holds
the clock, colony name, weather, stock, capacity, rates, population and housing, priorities, settler
summaries, building summaries, active events, the most recent 50 log entries, the outcome and the stats.

### 5.4 Controller (`src/game/types.ts`)

The `GameControllerApi` methods are `getState`, `newGame`, `dispatch`, `setSpeed`, `setPaused`,
`togglePause`, `saveGame`, `loadGame`, `listSaves`, `deleteSave`, `centerOn`, `zoomBy` and `advanceTicks`.
React gets the controller through `useGameController()`. Pointer routing works like this:

- In build mode, a left-click places the building, and the game exits build mode on success. A right-click cancels.
- Otherwise a left-click selects, and a right-click clears the selection.

---

## 6. Save format

- Key: `frontierColony.v1.save.<slot>`. The slots are `autosave`, `slot1`, `slot2` and `slot3`.
- Value: `JSON.stringify({ format: 'frontier-colony-save', schemaVersion, savedAt: ISO-8601, summary:
  { colonyName, day, timeOfDay, population, seed, preset }, state: GameState })`. A large map saves to about 0.5 MB.
- Load steps: parse the JSON, check the format, then `migrateEnvelope` (which upgrades older versions
  one step at a time and rejects newer ones), then `validateGameState`. The result is either
  `{ ok: true, state }` or `{ ok: false, error }`. These functions never throw.
- Autosave runs at each new in-game day and on `pagehide`. Manual saves go to the numbered slots.
- If localStorage is unavailable, an in-memory store is used, and saves last only for the session.

---

## 7. Determinism and testing strategy

- Unit tests (Vitest, node environment) cover:
  - RNG determinism and distribution
  - iso round-trips
  - `createGame` validity and determinism (deep-equal after N ticks)
  - command validation
  - save round-trips, including continuing the simulation identically after a load
  - the clock maths
  - store actions and snapshot isolation

  Each milestone adds tests for its systems: world generation per preset, A*, needs, the economy and events.
- E2E tests (Playwright, Chromium, against `vite preview`) cover:
  - the app loads, the canvas renders, and the console shows no errors
  - time advances, pause stops it, and speed changes take effect
  - the rest of each milestone's player flow, through `data-testid` hooks and `window.__frontierColony`

---

## 8. Non-functional requirements

- Startup takes under 3 s on a dev machine. Generating a 128² map takes under 500 ms.
- At 4x speed on a large map with 30 settlers, sim ticks take under 2 ms on average.
- Strict TypeScript with no type errors. The production build has no warnings beyond the chunk-size
  notice for PixiJS.
- Every interactive control can be reached with the keyboard where it makes sense (pause, speeds,
  closing panels). The UI text is readable over the map.

---

## 9. Acceptance criteria

| Milestone | Criteria |
|---|---|
| M1 Foundation | These all succeed: `npm install`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` and `npm run dev`. The contracts compile. The stub map renders, and time advances (W1, S9, C6 basic). |
| M2 World | W1 to W6: the same seed gives an identical map (unit test). All four presets generate playable maps, with the town-center area buildable and reachable. The camera pans and zooms (C8, V1, V5). |
| M3 Settlers | P1 to P5: settlers move around obstacles on A* paths and choose tasks with no input. Activity labels are visible in the inspector. Needs change over time. C1 works. |
| M4 Economy | R1 to R4, B1 to B8, S1 to S3, S5, C2 to C4: the player places a building, settlers haul materials and build it, and it produces. Rates are shown. |
| M5 Gameplay | S4, S6 to S8, C5, C7, C9: the colony can grow or fail, events fire, priorities change behaviour, and save then load round-trips in the browser. |
| M6 Polish | W7 to W9, V2 to V4, V6 to V10: the lead and the reviewer approve the screenshots. |
| M7 Quality | All tests are green, there are no open critical review findings, and V11 is met. |
| M8 Release | `npm ci && npm run build` succeeds on a fresh clone, and the docs are complete. |
