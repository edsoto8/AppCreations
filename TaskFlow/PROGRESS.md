# TaskFlow — Progress

| # | Milestone | Status |
|---|---|---|
| 1 | Environment and first application | Done |
| 2 | First user interface | Done |
| 3 | MVVM and data binding | Done |
| 4 | Task editing and navigation | Done |
| 5 | Local data storage | Done |
| 6 | UI improvements | Done |
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

## Milestone 4 — Task editing and navigation

- `EditTaskPage` + `EditTaskViewModel`: title, description, due date (`CalendarDatePicker`), priority, Save/Cancel,
  Ctrl+S and Escape accelerators, inline validation messages, error `InfoBar`.
- `TaskValidator` (title required, ≤ 100 chars; description ≤ 1000 chars), enforced again inside `TaskService`.
- `INavigationService` (`FrameNavigationService`) and `IDialogService` (`ContentDialogService`) keep `Frame` and
  `ContentDialog` out of view models. Delete now asks for confirmation; Cancel is the default button.
- Views moved to `Views/`. Tests: 34 passing (editor, validator, navigation and dialog fakes).
- Verified in the running app: empty-title error appears and clears while typing, priority via keyboard, date via
  calendar, Ctrl+S saves and returns, delete dialog (Enter cancels, Delete confirms), Edit pre-fills, Escape cancels.

## Milestone 5 — Local data storage

- `ITaskStore` / `JsonTaskStore`: versioned JSON (`{ "version": 1, "tasks": [...] }`), System.Text.Json source
  generation, enum names as strings, atomic save (temp file + `File.Move`), corrupt files moved to
  `tasks.corrupt-<timestamp>.json` with a user-facing warning, small problems repaired on load.
- `TaskService` loads at startup and saves after every change (one save at a time). If loading fails, saving is
  blocked so the unreadable file is never overwritten.
- App: data in `ApplicationData.Current.LocalFolder` (override with `TASKFLOW_DATA_DIR`), `ILogger` from the
  template's logger factory (Debug builds), load runs after the window appears, warning `InfoBar`.
- Tests: 64 passing (round trip, corrupt files, repair, IO failures, restart survival).
- Verified in the running app: added a task and completed it → `tasks.json` written; relaunched → task reloaded;
  corrupted the file → app started with the warning and the backup file. Default Linux path:
  `~/.local/share/TaskFlow/com.taskflow.app/LocalState/TaskFlow/tasks.json`.

## Milestone 6 — UI improvements

- `Styles/Theme.xaml` (Light/Dark `ThemeDictionaries`: priority colours, muted text) and `Styles/Styles.xaml`
  (text styles, card style, icon button style), merged in `App.xaml`.
- `Controls/PriorityBadge`: reusable `UserControl` with a `Priority` dependency property and one visual state per
  priority. `Ui.cs`: static helpers called from `x:Bind` (strikethrough, dimming, accessible labels).
- Main page: task cards, priority badges, due/overdue chips, completion progress bar, `RadioButtons` filter,
  empty state, `ProgressRing` while loading, closable error/warning `InfoBar`s, Ctrl+N.
- `ThemeService`: System → Light → Dark toggle saved in `LocalSettings`; dialogs get the theme explicitly.
- Responsive: `AdaptiveTrigger` at 720px on both pages (narrow: stacked controls, icon-only Add button).
- Accessibility: names on icon buttons ("Edit Renew passport"), tooltips, keyboard accelerators, focus on open.
- Verified in the running app: light and dark main page, dark dialog and editor, 420px narrow layout, empty
  state, Ctrl+N, theme choice remembered across launches.
- Known limitation: the dimming layer behind a dialog keeps the system theme's tint when the app theme is forced.
