# TaskFlow — Progress

| # | Milestone | Status |
|---|---|---|
| 1 | Environment and first application | Done |
| 2 | First user interface | Done |
| 3 | MVVM and data binding | Done |
| 4 | Task editing and navigation | Not started |
| 5 | Local data storage | Not started |
| 6 | UI improvements | Not started |
| 7 | Testing and code quality | Not started |
| 8 | Final review | Not started |

## Milestone 1 — Environment and first application

- .NET SDK 10.0.115 (Ubuntu package), `wasm-tools` workload, Uno.Templates 7.0.5.
- Created with `dotnet new unoapp -preset blank -presentation mvvm -markup xaml -theme fluent -nav blank -platforms desktop wasm`.
- Uno.Sdk 7.0.5 (pinned in `global.json`). `TreatWarningsAsErrors` added to `Directory.Build.props`.
- Verified: `net10.0-desktop` and `net10.0-browserwasm` build with 0 warnings; the desktop app launched under X11 (Xvfb) and rendered the starter page.

## Milestone 2 — First user interface

- Added `TaskFlow.Core` (plain `net10.0`) with the `TaskItem` model and `Priority` enum.
- `MainPage`: title, Add Task button, completed counter and a `ListView` of in-memory sample tasks, driven by a
  `Click` event handler in code-behind (replaced by MVVM in Milestone 3).
- Verified: built with 0 warnings; launched under Xvfb + openbox, clicked Add Task twice with `xdotool`, and the list
  grew to 5 tasks with the counter showing "1 of 5 completed".

## Milestone 3 — MVVM and data binding

- `TaskFlow.Core`: `TaskService` (single source of truth, raises `Changed`), `TaskQuery` (pure filter/sort),
  `CollectionSync` (in-place `ObservableCollection` updates), `TaskDraft`, `Choice<T>`.
- View models (CommunityToolkit.Mvvm partial properties + `[RelayCommand]`): `MainViewModel`, `TaskItemViewModel`.
- App: `AppServices` composition root; `MainPage` binds with `x:Bind` (filter/sort ComboBoxes, list, commands).
- `TaskFlow.Tests` (xUnit v3 on Microsoft.Testing.Platform): 12 tests passing.
- Verified in the running app: complete (checkbox), delete, add, counter update, filter ComboBox opens.
