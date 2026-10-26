# MetroSim benchmark results

- Date: 2026-10-26 16:58 UTC
- Machine: 4 logical cores, Ubuntu 24.04.5 LTS, X64
- Runtime: .NET 10.0.13, Release build, server GC off
- Command: `metrosim bench`

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

