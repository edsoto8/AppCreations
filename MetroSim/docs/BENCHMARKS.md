# MetroSim benchmarks

All numbers were measured on this project's build machine: 4 logical cores, Ubuntu 24.04 x64,
.NET 10.0.13, Release build, workstation GC. Regenerate them with
`dotnet run --project src/MetroSim.Cli -c Release -- bench --out docs/BENCHMARKS.raw.md`; the raw output
of the run quoted here is in `BENCHMARKS.raw.md`. Simulated time: 1 tick = 1 minute, so 1,440 ticks are
one in-game day. Game speeds need 12 / 48 / 192 ticks per second (1x / 2x / 3x).

## Summary

| Question | Answer (measured) |
|---|---|
| Simulation ticks per second | 4,000 TPS at ~2.8k–5k citizens; 1,550 at 10k; 300 at 20k (heavily congested); 76 at 40k (gridlocked). The 3x game speed (192 TPS) holds up to roughly 20k citizens. |
| Population scaling | Tick cost grows faster than linearly with population because congestion grows: more vehicles at once, more expensive congestion-aware searches and more reroutes. |
| Traffic routing | 13.5 µs per congestion-aware A* search on a 128x128 grid (74k searches/s), 24 µs on 256x256. |
| Memory | Simulation state is small: ~6 MB of managed heap for 40k citizens on a 224x224 map. Save files are ~350 KB for a 128x128 city. |
| Organic growth | The 12x12-block demo city ran 90 days (129,600 ticks) at 5,143 TPS overall, growing to 11.5k citizens with peak travel-time index ~1.25. |
| Rendering frame rate | See "Rendering" below. |

## Population scaling (synthetic dense city, one full simulated day)

| Citizens | Map | Build ms | Memory (managed) | ms/tick mean | ms/tick p99 | ticks/s | Peak vehicles | Trips/day | Searches | Nodes/search | Pathfinding share | Peak TTI |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2,768 | 64x64 | 46 | 0.9 MB | 0.248 | 3.195 | 4,026 | 284 | 5,067 | 5,067 | 55 | 34 % | 1.25 |
| 5,238 | 88x88 | 29 | 0.8 MB | 0.251 | 1.683 | 3,977 | 731 | 10,058 | 10,058 | 92 | 54 % | 1.31 |
| 10,245 | 120x120 | 15 | 1.5 MB | 0.644 | 3.421 | 1,552 | 2,451 | 20,016 | 20,553 | 188 | 57 % | 2.12 |
| 20,233 | 160x160 | 30 | 2.6 MB | 3.296 | 27.792 | 303 | 10,437 | 40,021 | 55,903 | 472 | 76 % | 4.88 |
| 40,238 | 224x224 | 91 | 6.0 MB | 13.158 | 62.920 | 76 | 38,314 | 25,463 | 96,283 | 994 | 74 % | 4.93 |

## Routing (A* on the road grid)

| Map | Road tiles | Cost model | Searches | µs/search mean | Nodes/search | Searches/s |
|---:|---:|---|---:|---:|---:|---:|
| 64x64 | 1,221 | uniform | 10,000 | 22.9 | 197 | 43,670 |
| 64x64 | 1,221 | live traffic | 10,000 | 9.7 | 75 | 102,663 |
| 128x128 | 5,104 | uniform | 10,000 | 97.6 | 827 | 10,249 |
| 128x128 | 5,104 | live traffic | 10,000 | 13.5 | 145 | 73,816 |
| 256x256 | 19,909 | uniform | 10,000 | 406.1 | 3,247 | 2,463 |
| 256x256 | 19,909 | live traffic | 10,000 | 23.9 | 256 | 41,821 |

## Organic growth (demo city with auto-mayor)

| Day | Population | Buildings | Peak vehicles (day) | Peak TTI (day) | ms/tick (day mean) | Managed memory |
|---:|---:|---:|---:|---:|---:|---:|
| 15 | 1,897 | 616 | 118 | 1.10 | 0.061 | 101 MB |
| 30 | 4,395 | 1,061 | 286 | 1.26 | 0.105 | 116 MB |
| 45 | 6,404 | 1,746 | 436 | 1.21 | 0.207 | 143 MB |
| 60 | 8,377 | 1,928 | 649 | 1.26 | 0.242 | 80 MB |
| 75 | 10,135 | 2,575 | 767 | 1.26 | 0.312 | 131 MB |
| 90 | 11,517 | 2,697 | 888 | 1.25 | 0.330 | 12 MB |

90 simulated days (129,600 ticks) in 25.2 s = 5,143 ticks/s overall; pathfinding 30 % of the time (1,050,514 searches, 57 nodes each).

## Profiling-driven optimisation

The first profile (`dotnet-trace collect --profile dotnet-sampled-thread-time -- metrosim profile
--citizens 20000`) showed pathfinding at **87% of tick time**: 19.7 s of a 22.7 s simulated day. Trip
dispatch accounted for ~40% and congestion reroutes for ~41%; heap pops alone were 22%. Each change
below was measured before it was adopted:

| Change | Workload | Before | After |
|---|---|---|---|
| Reroute budget 64→32 per tick, cooldown 30→60 ticks, 4,000-node cap per reroute | 20k citizens (first stress workload) | 15.9 ms/tick | 13.3 ms/tick |
| (same) | 5k citizens | 1.28 ms/tick | 0.95 ms/tick |
| Heap orders by f, then by h (tie-break toward the goal) | 5k / 20k | 602 / 1,888 nodes per search | unchanged: congestion costs rarely tie; kept because it is free |
| Weighted A*, weight 1.25 | 60-day 12x12 growing demo | 34.5M nodes, 4.5 s pathfinding | 23.1M nodes, 2.8 s; peak TTI 1.24→1.26, commute 26→25 min |
| Weighted A*, weight 1.5 (rejected) | same | 34.5M nodes | 16.8M nodes, but drivers ignored a 25%-faster avenue detour (a unit test caught it), which defeats the player's main anti-congestion tool |

The stress workload itself was also corrected. Its first version assigned jobs by striding across the
city, which produced 80-minute commutes even at 5k citizens. It now uses the game's own job matching.
`PROGRESS.md` records both versions.

What the profile still says: at 20k+ citizens, pathfinding remains 74–76% of tick time. The next
step is the routing work in the roadmap (contracted intersection graph or ALT landmarks, and route
reuse against a saved congestion snapshot), not micro-tuning elsewhere.

## Rendering

Avalonia 12 with SkiaSharp CPU rasterisation in this container (no GPU). Measured on the merged build:

| Measurement | Command | Result |
|---|---|---|
| Real X11 window (Xvfb, 1600x900), demo city day 4 morning, 1x | `xvfb-run -a MetroSim --demo --auto-mayor --days 4.33 --speed 1 --exit-after 12` | **51.8 FPS**, map draw 5.1 ms average / 8.6 ms max |
| Same, unlimited simulation speed | `... --speed max --exit-after 12` | **57.2 FPS** while the simulation ran at 9,944 ticks/s (day 102, 4,569 citizens) |
| Off-screen render, 1600x900, 300 frames each, city with no overlay | `MetroSim --demo --days 4.33 --benchmark-render 300 --resolution 1600x900` | 6.5 ms/frame average, 8.4 ms p95 (154 FPS of headroom) |
| Same, traffic overlay | (same run) | 7.4 ms/frame (135 FPS) |
| Same, close-up at 40 px per tile | (same run) | 6.5 ms/frame (154 FPS) |
| Same, whole map | (same run) | 4.2 ms/frame (237 FPS) |
| Same, simulation at max speed | (same run) | 6.9 ms/frame (136 FPS) |
| Frame snapshot on the UI thread | (same run) | 0.01–0.5 ms |

The window FPS tops out near 60 because the frame timer targets 60 Hz. The off-screen numbers show
the headroom.

Rendering optimisations found by measurement (app milestone):
- Chunk images in the platform's native pixel format draw about 10x faster than RGBA (30 ms → 6 ms
  per frame).
- At unlimited speed, the map refreshes from the simulation 5 times a second (immediately after a
  player command), and changed chunks over the per-frame budget reuse their previous image for a
  frame. This took FPS at max speed from 23 to 52.

Note on garbage collection: on this software-rendered platform, Avalonia triggers a full GC about
every other frame from its own frame buffers. The app's managed heap is about 3 MB, so each
collection is cheap.
