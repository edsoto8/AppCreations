# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a collection of independent apps, one per top-level folder. Each app has its own solution,
build settings, README and `CLAUDE.md`. Read the app's own `CLAUDE.md` before working in it, and run
its commands from that app's folder, not from the repo root (there is no root solution).

| Folder | What it is | Details |
|---|---|---|
| `SkyHop/` | Endless tap-to-flap arcade game: .NET 10 Blazor WebAssembly, pure C# game core, xUnit tests | `SkyHop/CLAUDE.md`, `SkyHop/README.md` |
| `StepRecorder/` | Windows system-tray step recorder: .NET 10 WPF app, platform-neutral core, xUnit tests | `StepRecorder/CLAUDE.md`, `StepRecorder/README.md` |
| `BoardFlow/` | Local-first Trello-style project board: .NET 10 Avalonia desktop app, SQLite + Dapper, Serilog, xUnit tests | `BoardFlow/CLAUDE.md`, `BoardFlow/README.md`, `BoardFlow/SPEC.md` |
| `DotNet11Lab/` | Interactive .NET 11 / C# 15 feature explorer: Blazor Web App + Minimal API, BenchmarkDotNet, Native AOT CLI, xUnit v3 on Microsoft.Testing.Platform. Needs .NET SDK 11 | `DotNet11Lab/CLAUDE.md`, `DotNet11Lab/README.md`, `DotNet11Lab/SPEC.md` |

`StepRecorder-MultiModel-Spec.md` (repo root) is the authoritative spec for `StepRecorder/`. That app is
built one milestone at a time; its `CLAUDE.md` holds the rules the spec sets for each milestone.
`BoardFlow/` keeps its spec, progress tracker and scorecard inside its own folder (`SPEC.md`,
`PROGRESS.md`, `SCORECARD.md`).

## Shared Conventions

- Apps so far are C#/.NET (DotNet11Lab targets .NET 11; the others .NET 10). Each app's `Directory.Build.props` sets nullable, implicit usings and
  `TreatWarningsAsErrors`. Use the same settings for new .NET apps.
- The root `.gitignore` is the standard Visual Studio one and covers every app.
