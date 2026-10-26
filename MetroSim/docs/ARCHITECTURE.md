# MetroSim Architecture

MetroSim is a tile-based city-building simulation. The simulation is a pure, deterministic C# library
that runs headlessly; rendering, input and persistence are separate layers on top of it.

```
 MetroSim.App (Avalonia 12 + SkiaSharp)      MetroSim.Cli (headless runner, benchmarks, verify)
          |  commands / read-only state          |
          v                                      v
 SimulationRunner (background thread, speed, command queue, state lock)   <- MetroSim.Core
          |
 Simulation (tick orchestrator)  ── World · Roads · Traffic · Citizens · Buildings · Economy · Infrastructure
          |
 SimulationSerializer (versioned binary chunks)  ->  MetroSim.Persistence (SQLite save container)
```

## Projects

| Project | Depends on | Responsibility |
|---|---|---|
| `MetroSim.Core` | nothing (BCL only) | All simulation rules, deterministic RNG and noise, command model, binary state serializer, state hash, background runner, scripted demo city |
| `MetroSim.Persistence` | Core, Microsoft.Data.Sqlite | Save files: SQLite container, format versioning, integrity validation, atomic writes |
| `MetroSim.Cli` | Core, Persistence | `new`, `run`, `demo`, `bench`, `verify` commands. Headless evidence for every subsystem |
| `MetroSim.App` | Core, Persistence, Avalonia | Interactive map, tools, overlays, dashboards |
| `tests/MetroSim.Tests` | Core, Persistence | Unit, property-based (CsCheck), integration, replay, save/load and stress tests |
| `tests/MetroSim.App.Tests` | App | Avalonia headless UI tests and rendered-frame screenshots |

## Key decisions (ADR summary)

1. **Avalonia + custom Skia drawing for the UI.** Cross-platform (Windows/macOS/Linux) desktop, already
   used in this repo (BoardFlow), and its headless platform renders real Skia frames, so the renderer
   can be exercised and screenshotted in a display-less container. A game engine (MonoGame, Raylib)
   would need a GPU/GL context and gives no headless frame capture. Trade-off: no GPU sprite batching;
   mitigated by caching the static map layers in bitmaps and culling dynamic objects to the viewport.
2. **Tile grid world.** One tile is one cell of terrain; roads, zones and buildings snap to tiles.
   Keeps every system O(tiles) or better and makes the rules testable. Zoned buildings are 1x1,
   service buildings are 2x2 or 3x3.
3. **Determinism.** The simulation is single-threaded and uses its own PCG32 generator (state is
   saved), integer money (cents, `long`), integer demand/satisfaction and integer movement
   (milli-tiles). Floating point is used only for terrain noise, which needs nothing beyond
   IEEE-exact `+ - * /` and `Math.Floor`. All entity collections iterate in id order; entity slots
   and their free lists are saved exactly. No `Dictionary`/`HashSet` iteration drives simulation
   decisions.
4. **Derived data is a pure function of saved data.** Caches such as road components, the
   intersection map and service coverage are rebuilt from saved state on demand. Anything sampled
   at a point in time (powered/watered flags, coverage results, demand, pollution) is saved. That is
   why a save/load at any tick continues bit-identically to an uninterrupted run (tested).
5. **Commands.** Every player action is a serializable `GameCommand` applied between ticks via
   `Simulation.Execute`, which validates, charges money, and appends it to the command log. Replaying
   the log from the seed reproduces the city exactly (`metrosim verify`).
6. **Save format: SQLite container with versioned binary chunks.** One `.city` file per save with a
   `meta` table (format version, seed, tick, summary values, whole-state SHA-256) and a `chunks`
   table (`name, version, length, sha256, data`). SQLite gives transactional single-file writes,
   built-in corruption checks (`PRAGMA quick_check`) and lets tools list saves without decoding them.
   Binary chunks keep the state bit-exact and fast to load. Writes go to a temp file and are
   atomically renamed over the target.
7. **Threading.** `SimulationRunner` owns a background thread that advances ticks at the selected
   speed. The UI takes `runner.StateLock` while reading state for a frame and enqueues commands, which
   the runner applies at the next tick boundary. Tick rate (TPS) and frame rate (FPS) are decoupled
   and measured separately.

## Time and scale

- 1 tick = 1 in-game minute; 1440 ticks per day; `DaysPerYear = 12` (citizens age one year every 12 days).
- Speeds: paused, 1x = 30 ticks/s, 2x = 120 ticks/s, 3x = 480 ticks/s, plus an uncapped "max" mode.
- Hourly work (every 60 ticks): demand, zone growth, migration, job matching, pollution and land value,
  coverage. Every 10 ticks: power and water allocation. Daily (midnight): budget, satisfaction,
  ageing/births/deaths, garbage, fires starting, abandonment, levelling up.

## Subsystems

### World generation (`World/`)
`TerrainGenerator` builds elevation from seeded fractal Perlin noise, sets water level and rock level
by percentile (`MapSettings.WaterCoverage`, `RockCoverage`), carves rivers by steepest descent, adds
beaches, and places trees from a second moisture noise field. Same `MapSettings` gives the same map.

### Roads (`Roads/`)
Roads are tile flags (`Street`, `Avenue`) on `CityMap.Roads`. Building over water makes a bridge (4x
cost); over rock costs 2x. `RoadGraph` derives the connected-component labels and the intersection
mask (3+ road neighbours) lazily. `Pathfinder` is A* on road tiles with reusable generation-stamped
buffers and a binary heap with insertion-order tie-breaking (deterministic). Edge cost = the expected
time to cross the next tile at its current congestion, plus an intersection delay. The heuristic is
Manhattan distance times the fastest free-flow tile time, so it stays admissible.

### Traffic (`Traffic/`)
Each road tile has four directional lanes (N/E/S/W of travel), each with a vehicle capacity
(Street 2, Avenue 4). A vehicle advances `speed` milli-tiles per tick. Speed drops linearly with
lane occupancy, down to 35% of free flow. A vehicle may only enter the next lane if that lane has
room, and an intersection admits a limited number of vehicles per tick (Street 1, Avenue 2, which
acts like signals). Queues and spill-back therefore emerge from demand alone. A vehicle that has
waited `RerouteAfterTicks` re-plans from its current tile with live congestion costs (budgeted per
tick). Removing a road under a route triggers re-planning; if no route remains the trip is aborted.
Short trips (≤ 6 tiles) are walked: pedestrians use the same paths but no lane capacity.
Metrics: active vehicles, trips completed per hour, mean trip time vs free-flow time (travel time
index), per-tile hourly volume (traffic overlay), average commute minutes.

### Citizens (`Citizens/`)
Each citizen has an age, a home, an optional job, a work start time (06:00–09:59) and a state
machine `AtHome → Commuting → AtWork → ReturningHome`, plus evening shopping trips to commercial
buildings (customer visits feed commercial revenue). Unemployed adults are matched hourly to the
nearest of a random sample of reachable vacancies. Satisfaction (0–100) is recomputed daily from
employment, power, water, garbage, health and fire coverage, pollution, commute time and tax.
Population changes through migration (move-in driven by residential demand; move-out driven by low
satisfaction or long unemployment), births and deaths.

### Buildings and zoning (`Buildings/`)
Players paint Residential/Commercial/Industrial zones on buildable tiles within 2 tiles of a road.
Hourly growth spawns buildings on candidate zoned tiles, in proportion to demand; construction takes
a few hours. Buildings level up (1–3, more capacity) after sustained good conditions and land value,
and are abandoned after sustained lack of road access, power, water, garbage collection or workers.
Abandoned buildings collapse after a few days, freeing the tile to regrow. Service buildings come from
`BuildingCatalog` (size, cost, upkeep, production, coverage).

### Economy (`Economy/`)
Money is in cents. Income is daily taxes: residential (per employed resident, by building level),
commercial (per worker plus per customer visit) and industrial (per worker), each with its own rate
(0–29%, default 9%). Expenses are daily road, power-line and service upkeep plus construction costs
charged immediately. Demand for each zone (-100..100) is computed hourly from jobs vs workers,
vacancies, satisfaction and tax rates. Each day is recorded in a budget ledger (income/expense by
category) shown in the finance dashboard.

### Infrastructure (`Infrastructure/`)
- **Electricity:** coal plants and wind turbines (output rises with elevation). Power reaches
  buildings and power lines within 2 tiles of each other (it crosses roads). Each grid hands out
  supply in breadth-first order from its plants; consumers past the supply limit stay dark.
- **Water:** pumps (next to water) and water towers. Pipes are assumed under roads, so each pump feeds
  its road component in road-BFS order up to capacity.
- **Garbage:** landfills (storage fills up) and incinerators (need power, pollute) collect from
  buildings within road range, nearest first, up to daily capacity. Uncollected garbage hurts
  satisfaction and eventually causes abandonment.
- **Fire:** buildings ignite at random (less often inside fire coverage). A covered fire station
  dispatches a fire truck that drives through live traffic; until it arrives, damage grows, so
  congestion costs buildings. Fires can spread to neighbours; at 100% damage the building is destroyed.
- **Health:** clinics improve satisfaction and halve the senior death rate within road range.
- **Pollution and land value:** industry, coal plants, incinerators and heavy traffic pollute; land value
  depends on water and tree proximity, services and pollution, and drives building levels.

## Interfaces the UI uses

- `SimulationRunner`: `Speed`, `StateLock`, `Enqueue(GameCommand, Action<CommandResult>?)`, `Pause()`,
  `MeasuredTicksPerSecond`, `TickCompleted` event.
- `Simulation`: `Map`, `Buildings`, `Citizens`, `Traffic`, `Economy`, `Stats`, `Clock`, `Events`,
  `Estimate(GameCommand)` (cost preview), `Execute(GameCommand)`.
- `CityMap` layer arrays (terrain, elevation, trees, roads, zones, building ids, power lines, pollution,
  land value), plus `MapVersion` and `TerrainVersion` counters so the renderer can rebuild cached layers.
- `TrafficSystem.Vehicles` (tile, next tile, progress, direction, kind) for interpolated drawing;
  `TrafficSystem.LaneLoad(tile)` and `HourlyVolume` for the traffic overlay.
- `SaveGameStore.Save(sim, path)` / `SaveGameStore.Load(path)` in Persistence.
