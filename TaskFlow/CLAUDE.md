# CLAUDE.md

TaskFlow is a learning project: a personal task manager in Uno Platform 7.0.5 / .NET 10 (XAML, MVVM with
CommunityToolkit.Mvvm, JSON file storage, xUnit v3). `SPEC.md` is the feature spec, `ARCHITECTURE.md` explains the
design and its decision log, `LEARNING.md` is the beginner guide, `PROGRESS.md` the milestone record. Keep those in
sync with the code — the user is learning from them.

## Commands

Run from this `TaskFlow/` folder:

```bash
dotnet build TaskFlow/TaskFlow.csproj -f net10.0-desktop     # app (warnings are errors)
dotnet run --project TaskFlow -f net10.0-desktop             # TASKFLOW_DATA_DIR=./tmp-data for throwaway data
dotnet run --project TaskFlow -f net10.0-browserwasm         # needs the wasm-tools workload
dotnet test                                                  # all tests (Microsoft.Testing.Platform via global.json)
dotnet test --project TaskFlow.Tests -- --filter-class TaskFlow.Tests.TaskQueryTests
dotnet format TaskFlow.Core/TaskFlow.Core.csproj             # and TaskFlow.Tests
```

On Linux without a display, run the app under Xvfb with a window manager and D-Bus
(`dbus-run-session`, `openbox`); without them the window doesn't repaint after input.

## Architecture rules

- **`TaskFlow.Core` has no Uno or XAML types** (no `Visibility`, brushes, `Frame`, `ContentDialog`). View models
  live there and are unit-tested directly. UI-only services (`FrameNavigationService`, `ContentDialogService`,
  `ThemeService`) live in `TaskFlow/Services`.
- **All changes go through `TaskService`**. It validates (`TaskValidator`), raises `Changed`, saves through
  `ITaskStore`, and undoes the change if saving fails. It refuses changes until a load succeeds or when the file
  is read-only.
- **`JsonTaskStore` must never lose user data**: atomic save, back up before discarding anything, bump
  `CurrentVersion` (and add a migration) when the file format changes.
- **Bindings use `x:Bind`** with explicit `Mode=OneWay`/`TwoWay`. Use `Ui.cs` functions instead of converters.
- Colours go in `Styles/Theme.xaml` (both Light and Dark), shared styles in `Styles/Styles.xaml`.
- `AppServices` is the composition root; pages get view models from `App.Services`.
- Keep it beginner-friendly: no new frameworks or packages without a clear reason recorded in ARCHITECTURE.md.

## Conventions

- C#, four-space indent, file-scoped namespaces `TaskFlow.*`, `sealed` classes by default, XML doc comments
  that explain *why* for a learner.
- Tests: `Subject_Condition_Outcome` names; fakes in `TestSupport.cs`; real files in `TempFolder` for storage tests;
  pass `TestContext.Current.CancellationToken` to async APIs (xUnit analyzer).
