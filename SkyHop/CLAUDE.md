# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkyHop is an original endless tap-to-flap arcade game. It is a Blazor WebAssembly app with a pure C#
game core. `README.md` covers controls, structure, tuning and debug mode.

## Solution Structure

```
SkyHop/
├── src/SkyHop.Core/      Game simulation, no dependencies (no Blazor, no JS)
├── src/SkyHop.Web/       Blazor WebAssembly host + JS canvas renderer, input and audio
└── tests/SkyHop.Tests/   xUnit tests for SkyHop.Core
```

Dependency rule: `Core` depends on nothing. `Web` and `Tests` depend on `Core`.

## Commands

```bash
dotnet build                                           # whole solution (warnings are errors)
dotnet test                                            # all tests
dotnet test --filter "FullyQualifiedName~Difficulty"   # one test class
dotnet run --project src/SkyHop.Web                    # http://localhost:5180 (add ?debug=1 for the debug overlay)
dotnet format                                          # before committing
```

Run all commands from this `SkyHop/` folder.

## Key Architectural Decisions

- **All tuning lives in `GameConfig.cs`.** Don't scatter gameplay numbers through other files.
- **Fixed timestep.** `Game.Update` runs whole `Timing.FixedStep` steps, so physics are deterministic
  and the same at any frame rate. Tests call `Game.Step` directly.
- **Input is abstract.** Core only sees `InputAction`. `wwwroot/js/input.js` maps keys, mouse and touch to
  action names, and `GameView.OnAction` forwards them.
- **JS owns the frame loop and drawing.** Each frame `main.js` calls `GameView.Tick(dt)` (a synchronous
  WASM interop call) and draws the returned `GameSnapshot`. Sounds and effects are driven by the
  snapshot's `events`. JS never changes game state.
- **Razor renders only the overlays** (start, pause, game over). `GameView` re-renders only when the
  overlay key (state, restart-ready, muted) changes, not every frame.
- **Obstacles are pooled** in `ObstacleSpawner`. `GameSnapshot` reuses its obstacle views too.
- **Fairness is tested.** `TestSupport.Autopilot` must reach max difficulty on every seed. If retuning
  breaks that test, the new tuning is probably unfair, not the bot.

## Coding Conventions

- C# with four-space indentation, PascalCase for public members, camelCase for locals
- Namespace prefix: `SkyHop.*`
- Test class naming: `DifficultyTests`; test method pattern: `Level_ChangesAtConfiguredThresholds`
