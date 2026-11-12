# TaskFlow

A clean, minimal personal task manager built with **Uno Platform 7** and **.NET 10** — and a step-by-step
learning project for Uno Platform. One C#/XAML codebase runs on **macOS, Windows and Linux desktops** and in the
**browser (WebAssembly)**, and is structured so Android and iOS can be added later.

- Create, edit, complete and delete tasks (title, description, due date, Low/Medium/High priority)
- Filter (All / Active / Completed), sort (due date / priority), total and completed counts
- Saved automatically as a local JSON file; survives restarts; corrupt files are backed up, never lost
- Light, Dark or System theme, responsive layout, keyboard shortcuts, accessible names on every button

New to Uno? Start with [LEARNING.md](LEARNING.md). The design is explained in [ARCHITECTURE.md](ARCHITECTURE.md),
the feature list and acceptance criteria are in [SPEC.md](SPEC.md), and milestone status is in [PROGRESS.md](PROGRESS.md).

## Requirements

| What | Version | Notes |
|---|---|---|
| .NET SDK | 10.0 | `dotnet --version` should print `10.0.x` |
| Uno Platform | 7.0.5 | Restored from NuGet automatically (pinned in `global.json`); nothing to install |
| `wasm-tools` workload | — | Only for the WebAssembly target: `dotnet workload install wasm-tools` |

The easiest way to check a machine is Uno's own checker, which also offers to fix what's missing:

```bash
dotnet tool install -g uno.check
uno-check
```

Platform notes:

- **macOS** (primary target): nothing else needed. The desktop app renders with Metal.
- **Windows**: nothing else needed. The same `net10.0-desktop` build runs as a Win32 app.
- **Linux**: needs X11 plus `libfontconfig1`, `libx11-6`, `libxrandr2`, `libxi6`, `libgl1` and a D-Bus session
  (see Uno's Linux setup guide).

An IDE is optional. Visual Studio Code with the Uno Platform extension, Rider or Visual Studio 2022+ all work;
they add XAML Hot Reload.

## Run it

All commands run from this `TaskFlow/` folder.

```bash
dotnet run --project TaskFlow -f net10.0-desktop        # desktop app (macOS / Windows / Linux)
dotnet run --project TaskFlow -f net10.0-browserwasm    # WebAssembly; opens a local web server
dotnet test                                             # all unit tests
dotnet test --project TaskFlow.Tests                    # same, just the test project (faster)
dotnet build TaskFlow/TaskFlow.csproj -f net10.0-desktop
```

Try it with throwaway data by pointing the app at another folder:

```bash
TASKFLOW_DATA_DIR=./tmp-data dotnet run --project TaskFlow -f net10.0-desktop
```

## Where your tasks are stored

Tasks live in `tasks.json` inside the app's local data folder (`ApplicationData.Current.LocalFolder`):

| Platform | Location |
|---|---|
| Linux (verified) | `~/.local/share/TaskFlow/com.taskflow.app/LocalState/TaskFlow/tasks.json` |
| macOS | The same `~/.local/share/...` path, per Uno's docs for Unix-like systems (not verified on a Mac here) |
| Windows | `%LOCALAPPDATA%\TaskFlow\com.taskflow.app\LocalState\TaskFlow\tasks.json` (per Uno's docs) |
| WebAssembly | The browser's IndexedDB storage for the site |

Debug builds print the exact path at startup (`Tasks are stored in ...`). The file is plain, indented JSON. If it
ever becomes unreadable, TaskFlow renames it to `tasks.corrupt-<timestamp>.json`, starts with an empty list and
tells you.

## Keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| Ctrl+N | Task list | Add a task |
| Ctrl+S | Editor | Save |
| Esc | Editor | Cancel / back |
| Tab / Shift+Tab, Space, Enter | Anywhere | Move focus, toggle check boxes, press buttons |

On macOS the shortcuts use the Control key as written (Uno does not remap them to Command).

## Project structure

```
TaskFlow/
├── TaskFlow/            Uno app (single project): XAML pages, styles, app-specific services
├── TaskFlow.Core/       Plain net10.0 library: models, view models, rules, JSON storage (no Uno)
├── TaskFlow.Tests/      xUnit v3 tests for TaskFlow.Core
├── global.json          Pins Uno.Sdk 7.0.5 and selects the Microsoft.Testing.Platform test runner
├── Directory.Build.props   Nullable, implicit usings, warnings as errors (all projects)
└── Directory.Packages.props Central package versions
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UNOWA0001 ... wasm-tools workload could not be located` | `dotnet workload install wasm-tools` |
| `Testing with VSTest target is no longer supported` | Run from this folder so `global.json` is picked up |
| `Uno.Templates ... no NuGet feeds are configured` | `dotnet nuget add source https://api.nuget.org/v3/index.json -n nuget.org` |
| Small Uno toolbar in the top-left corner | Uno's Hot Design / Studio toolbar, Debug builds only (`MainWindow.UseStudio()` in `App.xaml.cs`) |
| Linux: window doesn't repaint, or `_NET_WM_STATE does not exist` errors | Run under a desktop session (a window manager and D-Bus) |
