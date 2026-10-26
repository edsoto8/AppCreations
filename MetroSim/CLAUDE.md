# CLAUDE.md

MetroSim is a Cities: Skylines-inspired city builder (.NET 10): a deterministic, headless simulation
core, an SQLite save format, a CLI for headless runs and benchmarks, and an Avalonia 12 desktop app.
`docs/ARCHITECTURE.md` is the design record, `PROGRESS.md` the build log and resume point,
`docs/BENCHMARKS.md` the performance evidence, and `README.md` covers usage and known limitations.

## Commands

Run from this `MetroSim/` folder:

```bash
dotnet build                                                     # whole solution (warnings are errors)
dotnet test tests/MetroSim.Tests --filter "Category!=Stress"     # fast core suite (~15 s)
dotnet test tests/MetroSim.Tests                                 # incl. stress tests (~1 min)
dotnet test tests/MetroSim.App.Tests                             # Avalonia headless UI tests
dotnet run --project src/MetroSim.Cli -c Release -- demo --days 30          # headless demo city
dotnet run --project src/MetroSim.Cli -c Release -- bench --out docs/BENCHMARKS.raw.md
dotnet run --project src/MetroSim.Cli -c Release -- verify path/to/city.city # integrity + replay
dotnet run --project src/MetroSim.App                            # the game (xvfb-run -a on Linux without a display)
```

## Architecture rules

- **`MetroSim.Core` has no dependencies and no I/O.** All rules live there; the App only reads state
  (under `SimulationRunner.StateLock`) and issues `GameCommand`s.
- **Determinism is a feature with tests.** Use `Pcg32` streams from `Simulation.Rng`, integer maths
  (money in cents), and iterate entity stores by id. Never let `Dictionary`/`HashSet` iteration order,
  wall-clock time or culture-dependent formatting influence simulation state.
- **Anything that influences a later tick must be saved** (add it to `SimulationSerializer` and bump the
  chunk version if the layout changes), unless it is a cache rebuilt from saved state on demand (keyed on
  `CityMap.RoadVersion`/`TerrainVersion` or `Simulation.BuildingsVersion`). `DeterminismTests` and the
  serializer round-trip property catch violations.
- **Player actions are commands** applied between ticks via `Simulation.Execute`, validated in
  `CommandProcessor` and logged for replay. `Estimate` must never mutate state.
- New cross-system rules belong in `tests/MetroSim.Tests/Support/Invariants.cs`.

## Conventions

- C#, four-space indent, file-scoped namespaces `MetroSim.*`, `sealed` classes by default, XML doc
  comments on public members that carry rules.
- Tests: xUnit v3 + CsCheck. Names follow `Subject_Condition_Outcome`. Use `TestWorld.Flat` for unit
  worlds, `DemoRun` for the scripted city, `SyntheticCity` for known populations. Mark slow tests
  `[Trait("Category", "Stress")]`.
- Tuning numbers live in `BuildingCatalog`, `ZoneLevels`, `RoadSpecs`, `EconomyModel` and the
  constants at the top of each system. Re-run `demo` and `bench` after changing them and keep
  `docs/BENCHMARKS.md` and `PROGRESS.md` truthful.
