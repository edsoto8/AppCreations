# MetroSim

A city-building simulation inspired by Cities: Skylines, written in C# on .NET 10. Interlocking systems
produce observable consequences: zoned land grows into buildings when there is demand; citizens commute
along A*-routed roads; congestion emerges from lane capacity and intersection limits; and the budget,
utilities and services decide whether the city thrives or empties out.

- **Deterministic, headless core** (`MetroSim.Core`, no dependencies): the same seed and the same player
  commands always produce the same city, bit for bit, including after any save/load.
- **Desktop app** (`MetroSim.App`, Avalonia 12 + SkiaSharp) for Windows, macOS and Linux.
- **SQLite save files** with versioned chunks, per-chunk SHA-256 and a whole-state fingerprint.
- **CLI** (`MetroSim.Cli`) for headless runs, save verification by replay, and benchmarks.

See `docs/ARCHITECTURE.md` for the design, `docs/BENCHMARKS.md` for performance, `PROGRESS.md` for the
build log.

## Build and run

Requirements: .NET SDK 10.0 (tested with 10.0.113). From this folder:

```bash
dotnet build                                   # everything (warnings are errors)
dotnet run --project src/MetroSim.App          # play
dotnet run --project src/MetroSim.App -- --seed 1234
dotnet run --project src/MetroSim.App -- --load ~/my.city
dotnet test                                    # all tests
```

On Linux without a display, the app runs under `xvfb-run -a`. The UI tests need no display: they use
Avalonia's headless platform with real Skia rendering.

### Headless CLI

```bash
cd src/MetroSim.Cli
dotnet run -c Release -- demo --days 30                      # scripted demo city, daily report
dotnet run -c Release -- demo --size 192 --blocks 12 --days 90 --save big.city
dotnet run -c Release -- run --load big.city --days 10       # continue a save headlessly
dotnet run -c Release -- verify big.city                     # integrity checks + replay from seed
dotnet run -c Release -- new --out empty.city --seed 7 --size 128
dotnet run -c Release -- bench --out ../../docs/BENCHMARKS.raw.md
dotnet run -c Release -- profile --citizens 20000            # fixed workload for profilers
```

`demo` lays out a starter grid through ordinary player commands, then lets a scripted auto-mayor add
power, water, garbage, fire and health services, and new blocks, as needed. Every action goes through
the command log, so `verify` can replay the whole city from its seed.

## How the simulation works

| System | What happens |
|---|---|
| World | Seeded fractal Perlin terrain: water and rock levels by percentile, carved rivers, beaches, moisture-driven forests. Map 32–512 tiles per side. |
| Roads | Streets and avenues (more lanes, faster). Bridges over water cost 4x, rock 2x. Connected components and intersections are derived automatically. |
| Traffic | Four directional lanes per road tile with finite capacity. Speed drops as a lane fills, intersections admit a few vehicles per tick, and full lanes block entry, so queues and spill-back emerge. Weighted A* routes over live congestion costs; stuck drivers re-plan. Short trips are walked. |
| Citizens | Age, home, job, work start time and an evening shopping trip. They commute (cars or walking), keep a daily satisfaction score, are born, age, retire and die, move in when there is demand, and move out when unhappy or long unemployed. |
| Zoning | R/C/I zones develop within 2 tiles of a road in proportion to demand. Buildings level up (1–3) with sustained services and land value. They are abandoned after days without road access, power, water, garbage collection or workers, and collapse later. |
| Economy | Money in integer cents. Daily taxes per zone (0–29%), road and service upkeep, construction costs. R/C/I demand comes from jobs vs workforce, vacancies, satisfaction and tax rates. Every day is kept in a ledger. |
| Power | Coal plants and wind turbines (output rises with elevation). Power flows between buildings, zoned land and power lines up to 2 tiles apart; a short grid serves services first, then the nearest buildings. |
| Water | Pumps (next to water) and towers feed their road network. Pipes are assumed under roads. |
| Garbage | Landfills (fill up) and incinerators (need power, pollute) collect from the nearest buildings by road. |
| Fire | Random ignitions. A covered station dispatches a truck that drives through live traffic; fires spread and destroy buildings until a truck arrives. |
| Health | Clinics raise satisfaction and halve senior mortality within their road range. |
| Land | Pollution from industry, plants, incinerators and heavy traffic. Land value from water, trees and services. |

One tick is one in-game minute. Speeds are 1x/2x/3x = 12/48/192 ticks per second, plus unlimited.

## Playing

<!-- APP-CONTROLS -->
_The desktop app section is completed with the app milestone; see PROGRESS.md._

## Tests

`tests/MetroSim.Tests` (xUnit v3 + CsCheck), 137 tests:

- **Unit:** RNG (PCG reference vectors), noise, heap, terrain, pathfinding, commands and costs, economy
  formulas, utilities, services, traffic, citizens.
- **Property-based:** random 30-step player sessions keep every cross-system invariant (population
  counts, lane occupancy, building map, vehicle links, money explained by the ledger). Serialize →
  deserialize → serialize is the identity. A* matches BFS shortest paths. Weighted A* stays within
  its bound. Demand, satisfaction and tax stay in range and behave monotonically.
- **Integration:** a demo city grows and functions. Removing power plants causes blackout,
  abandonment and population loss. Removing water lowers satisfaction. Higher taxes raise income but
  slow growth. Missing garbage service piles up garbage. More commuters raise travel time and an
  avenue relieves it. Fire stations reduce buildings lost.
- **Determinism and replay:** identical runs, replay from the command log, and bit-identical
  continuation after a snapshot mid-commute, before the hour, at midnight, and through a save file.
- **Save/load:** round trip, summary, atomic overwrite, plus rejection of flipped bytes, consistently
  tampered chunks, missing chunks, newer formats, foreign SQLite files, random bytes, truncation and
  missing files.
- **Stress** (`Category=Stress`): 20,000 citizens commuting for a full day, a 30-day demo city
  checked daily, and a 100-day accounting drift check.

## Known limitations

- **Traffic is tile-level.** No lane changing, turn lanes, signals, one-way roads, highways, parking
  or public transport. Intersections are modelled as an admission cap per tick.
- **Service vehicles.** Garbage collection and health coverage have no vehicles; only fire trucks
  drive. There is no police, crime or education.
- **Utilities.** Water pipes are implicit under roads and there is no sewage. Power lines are simple
  conductors with no capacity limit.
- **Economy.** There are no loans, per-service budgets or goods chain between industry and commerce.
- **Terrain.** It is static after generation: no terraforming, and elevation does not affect roads.
- **Zoned buildings are 1x1 tiles.** There are no lots, districts or policies.
- **Cross-platform determinism** is designed for (integer simulation; terrain uses only IEEE-exact
  operations) but verified only on Linux x64. Replays require the same build, because tuning
  constants are not stored in saves.
- **Very dense cities.** At 40k citizens on 224x224, the network gridlocks and ticks take ~13 ms. See
  the roadmap.
- **The auto-mayor is a simple script for demos and benchmarks**, not an AI opponent.

## Roadmap (prioritised)

1. **Traffic depth:** signal phases and turn costs, one-way roads and highways with ramps, so players
   have more tools than avenues against congestion.
2. **Public transport:** bus lines on the same routing graph, with mode choice by travel time.
3. **Routing scale:** contracted intersection graph or landmarks (ALT), plus route caching against a
   saved congestion snapshot, for 50k+ citizens.
4. **Service vehicles** for garbage and ambulances, plus police/crime and schools, so every service
   interacts with traffic.
5. **Economy depth:** goods deliveries from industry to commerce (truck traffic), loans, per-service
   budgets, districts and policies.
6. **Deterministic parallelism:** partition per-tick work (citizens, traffic) into fixed shards with
   ordered merges.
7. **Terrain tools:** terraforming, slopes, elevated roads and bridges.
8. **Save format v2:** compression and a tested migration path from v1.
