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
| M2 | Persistence (SQLite container, integrity, replay verifier) + CLI `new/run/verify` | code written, tests pending |
| M3 | Test suite: unit, property-based, integration, replay, save/load, stress | pending |
| M4 | Avalonia app: map, tools, overlays, dashboards, save/load (Graphics Engineer agent) | in progress |
| M5 | Benchmarks + profiling-driven optimisation | pending |
| M6 | Independent code review, fixes, docs, limitations, roadmap | pending |

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
