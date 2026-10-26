# MetroSim progress log

Build log and resume point. Newest entries at the bottom of each section. Every claim below names the
command or test that verified it.

## Environment (2026-10-26)

- Ubuntu 24.04 container, 4 cores, 15 GB RAM, no display (Xvfb available).
- `dotnet` was not installed; the dot.net install script host is blocked by the egress proxy, so the
  SDK came from Ubuntu's archive: `apt-get install dotnet-sdk-10.0` → SDK 10.0.113 / runtime 10.0.13.
- NuGet (api.nuget.org) works through the proxy. Avalonia 12.1.3 restores (as used by BoardFlow).

## Milestones

| # | Milestone | Status |
|---|---|---|
| M0 | Environment, architecture (`docs/ARCHITECTURE.md`), solution skeleton | done |
| M1 | Headless core vertical slice: terrain, roads, A*, traffic, citizens, zoning/growth, economy, power, water, garbage, fire, health, land value, commands, serializer, runner, demo city + auto-mayor, CLI `demo` | done |
| M2 | Persistence (SQLite container, integrity, replay verifier) + CLI `new/run/verify` | done |
| M3 | Test suite: unit, property-based, integration, replay, save/load, stress | done (137 tests) |
| M4 | Avalonia app: map, tools, overlays, dashboards, save/load (Graphics Engineer agent) | done |
| M5 | Benchmarks + profiling-driven optimisation | done |
| M6 | Independent code review, fixes, docs, limitations, roadmap | done |

## M1 notes

- `dotnet run --project src/MetroSim.Cli -- demo --days 30` (seed 42, 128x128, 6x6 blocks): population
  0 → ~2,900 by day 20, peak travel-time index rises 1.00 → 1.80 as commuting grows (congestion emerges),
  1,734 dynamic reroutes, fires extinguished and burned down, garbage-driven abandonment when capacity
  lags. ~0.3 ms/tick at 2.6k population.
- Tuning found by running the demo (see git history):
  - power only conducting through buildings fragmented the early grid → zoned land conducts too;
  - a plant under construction counted as zero output → auto-mayor double-bought plants;
  - job targets below the workforce share stalled growth → industrial target fills jobs to ~110% of the
    workforce;
  - a brownout unpowered the distant water pump first and abandoned 450 buildings → services get power
    priority over zoned buildings.

## M2 notes

- Runtime check of the CLI (Release build): `demo --days 3 --save demo.city` → `verify demo.city` reports
  container/chunk/fingerprint OK and "Replay: 50 commands from seed to tick 4320 -> identical state";
  `run --load demo.city --days 2 --save demo2.city` → `verify` also replays to an identical state;
  flipping one bit in the `buildings` chunk makes `verify` fail with "chunk 'buildings' failed its
  checksum" (exit 1).

## M3 notes

- `dotnet test tests/MetroSim.Tests` → 137 passed (unit, CsCheck properties, integration, determinism,
  save/load, stress).
- Bugs the tests found: `RoadGraph.ComponentCount` read a stale value before the lazy rebuild (could
  under-size the water allocation array); the auto-mayor double-bought plants/incinerators that were
  still under construction and stalled when a purchase failed for lack of space; the commute-time test
  was biased toward early arrivals.

## M5 notes (profiling evidence)

- `dotnet-trace` on `metrosim profile --citizens 20000`: pathfinding was 87% of tick time
  (19.7 s of 22.7 s), split between trip dispatch (~40%) and congestion reroutes (~41%).
- Changes, each measured with `profile` / `demo` before adoption:
  - reroute policy (budget 64→32/tick, cooldown 30→60, 4,000-node cap): 20k stride workload
    15.9 → 13.3 ms/tick; 5k 1.28 → 0.95 ms/tick;
  - weighted A* 1.25 (plus f-then-h heap ordering): 60-day 12-block demo 34.5M → 23.1M nodes expanded,
    pathfinding 4.5 s → 2.8 s, peak TTI and commute unchanged; 1.5 was faster still but let drivers
    ignore a 25%-faster avenue (caught by `FindPath_PrefersFasterAvenueWithTrafficCosts`);
  - the synthetic stress city now uses the game's own job matching (the stride assignment produced
    80-minute commutes even at 5k citizens and gridlock at 20k).
- Results: `docs/BENCHMARKS.md`.

## M6 notes: independent review of Core, Persistence and CLI

A read-only reviewer agent tried to break the design claims with throwaway programs. It confirmed
11 issues; all are fixed with regression tests (`dotnet test tests/MetroSim.Tests` → 157 passed):

1. A fire truck was lost forever when a burning building was removed while the truck was on site.
   `RemoveBuildings` now sends it home. `Invariants` now checks that `TrucksOut` equals the trucks
   actually out.
2. A reused id made a new station inherit the removed station's trucks, and shops inherit visitors.
   Removal now clears every reference to the removed ids.
3. Malformed saves could escape `Load` as `IOException`, `OverflowException`, `InvalidCastException`
   or `FormatException`. All are now mapped to `SaveGameException`; metadata uses `TryParse`, and
   column types, `user_version` and format ≤ 0 are checked.
4. A hostile entity-table header could force multi-GB allocations. Headers are now bounded by the
   bytes remaining.
5. Undefined enum values in commands were accepted, crashing the hourly tick or producing unloadable
   saves. They are rejected in `CommandProcessor` and `CommandCodec`.
6. Routing settings were not saved, so `demo --weight 100 --save` failed `verify`. They are now
   serialized and applied by `ReplayVerifier`.
7. A free list overlapping live ids loaded and then corrupted entities. `EntityStore.Restore` now
   requires disjoint, covering ids, and loads check citizen/building/vehicle cross-references.
8. An absurd tick loaded and overflowed `Day`. The tick is capped and `Day` is checked.
9. Bulldozing 4,187 buildings scanned all citizens per building (241 ms). Removal is now batched:
   32 ms measured.
10. `Daily_AgeingRetiresWorkers` asserted nothing (its citizen had always moved out). Fixed. Added a
    property test that snapshots mid-session and continues, and a test for the post-load fingerprint.
11. A commute longer than the 8-hour shift left the citizen at work for a day. The shift now ends at
    a saved tick.

Also: the CLI reports `SaveGameException` cleanly (exit 1), and `ARCHITECTURE.md` numbers were synced
with the code. Not changed: integrity hashes are unkeyed SHA-256, so a deliberate edit that also
recomputes hashes and stays consistent still loads. `verify` (replay) detects it. Documented in the
README.

## M4 notes (desktop app)

- Built by a Graphics Engineer agent in an isolated worktree against the public Core API, then
  merged. After the merge (with the post-review Core): `dotnet build` gives 0 warnings;
  `dotnet test` passes 157 core + 30 app tests.
- Verified by me on the merged build:
  - real Xvfb window at 51.8 FPS (1x) and 57.2 FPS at unlimited speed (9,944 ticks/s);
  - off-screen 1600x900 rendering at 6.5 ms/frame;
  - screenshots checked by eye (`docs/screenshots/`): city at day 10, traffic overlay, budget panel
    with tax sliders, vehicle inspector with its route.
- The agent's reports:
  - a city collapse in one long max-speed run on its pre-review Core. Not reproduced afterwards:
    `demo --seed 7` and `--seed 1234` for 330 days both stay at ~4.6–4.8k citizens with a growing
    treasury. The fire-truck leak fixed in M6 is the likely cause.
  - lock contention at unlimited speed (worked around in the app);
  - the auto-mayor is unavailable after loading (its plan is not saved).
  Both remaining items are listed in the README under limitations and roadmap.
- Not verified: native file pickers (test fakes only), GPU rendering, and Windows/macOS runs. The CLI
  publishes for win-x64, osx-arm64, osx-x64 and linux-arm64; that is packaging evidence, not runtime
  evidence.

## Resume point

All milestones M0–M6 are done. Next work comes from the prioritised roadmap in `README.md`.
