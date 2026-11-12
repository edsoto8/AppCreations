# TaskFlow — Progress

| # | Milestone | Status |
|---|---|---|
| 1 | Environment and first application | Done |
| 2 | First user interface | Done |
| 3 | MVVM and data binding | Done |
| 4 | Task editing and navigation | Done |
| 5 | Local data storage | Done |
| 6 | UI improvements | Done |
| 7 | Testing and code quality | Done |
| 8 | Final review | Done |

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

## Milestone 7 — Testing and code quality

- 96 xUnit tests covering creation, completion, editing, deletion, filtering, sorting, serialization, invalid
  input, corrupt files, save failures, loading, dates and formatting. `dotnet format --verify-no-changes` clean.
- An independent code review found real issues; all were fixed with a regression test each:

| Finding | Fix |
|---|---|
| A failed save left the change in memory, so retrying "Add" created a duplicate | `TaskService` undoes the change when saving fails, so memory always matches the file |
| Adding a task while loading was still running lost the task | Add is disabled while loading; `TaskService` rejects changes before a successful load, without touching memory |
| A file from a newer TaskFlow version lost unknown data on the next save | Newer versions open read-only, with a warning |
| One bad task in the file hid all tasks | Tasks are read one by one; bad ones are skipped, the original file is backed up, and the user is told how many |
| Save snapshots shared live `TaskItem` objects | Snapshots are deep copies (`TaskItem.Clone`) |
| "Due today" and overdue labels went stale after midnight | `MainPage` timer calls `RefreshIfDayChanged` every minute |
| A startup failure gave a blank window | `OnLaunched` catches it and shows an error screen |
| Possible off-by-one due date in other time zones | Picker values are converted to local time before taking the date. Verified in the app at UTC+13 and UTC−8 |
| Save stayed clickable for a deleted task | `SaveCommand.CanExecute` is false |

- Found while testing: tasks written without an `id` all loaded as `Guid.Empty`, because the source-generated
  serializer skips property initializers, and then collapsed into one task. They now get fresh ids.
- Verified in the running app: forced save failure → error shown in the editor, text kept, list unchanged after
  Cancel. WebAssembly: ran in headless Chromium; add + page reload kept the task (IndexedDB).

## Milestone 8 — Final review

| Check | Result |
|---|---|
| Clean build `net10.0-desktop` Debug / Release, `net10.0-browserwasm` Debug | 0 warnings, 0 errors (warnings are errors) |
| `dotnet test` (whole solution) | 96 passed, 0 failed, 0 skipped |
| `dotnet format --verify-no-changes` (Core, Tests) | Clean |
| Dependencies | Core: CommunityToolkit.Mvvm 8.4.2, Microsoft.Extensions.Logging.Abstractions 10.0.14. Tests: xunit.v3 4.0.3. App: Uno.Sdk 7.0.5 implicit packages (`UnoFeatures`: Skia only). No third-party packages. |
| Separation of concerns | No `Microsoft.UI`, `Windows.UI`, `Uno`, `Visibility` or brush types anywhere in `TaskFlow.Core` |
| Persistence | Verified in the running app: save, restart reload, corrupt-file backup, save failure rollback, time zones |
| Desktop workflows (Release build) | Launched; light/dark/narrow screenshots in `docs/screenshots/` |

### What was and was not verified

| Verified here (Linux container) | Not verified |
|---|---|
| Desktop app on Linux X11 (Xvfb + openbox + D-Bus), Debug and Release | Running on a real **macOS** or **Windows** machine (same `net10.0-desktop` build; expected to work per Uno docs) |
| Add / edit / complete / delete / filter / sort / validation / dialogs / keyboard shortcuts / theme / responsive layout, driven with `xdotool` | Screen readers (accessible names were set but not heard) |
| JSON persistence, recovery and save-failure handling | Default data path on macOS/Windows (taken from Uno docs) |
| WebAssembly in headless Chromium, including persistence across reload | Startup-error screen (code path not triggered) |
| Due dates at UTC+13 and UTC−8 | XAML Hot Reload (needs an IDE + Uno account) |

## Remaining work / ideas

Version 1 scope is complete. Suggested follow-ups (details in LEARNING.md, "Where to go next"): search, undo
delete, tags with a v2 file format, due-date reminders, an Android/iOS head.

## Environment notes (for reproducing this build)

- The container had no .NET SDK. `dot.net`/`builds.dotnet.microsoft.com` were blocked by the network policy, so
  the SDK came from Ubuntu's `dotnet-sdk-10.0` package (10.0.115). `platform.uno` was blocked too; Uno's docs
  were read from their source in the `unoplatform/uno` repository.
- Ubuntu's SDK has no default NuGet feed for `dotnet new install`; the template package was downloaded from
  nuget.org and installed from the file.
- `dotnet workload install wasm-tools` was needed for the WebAssembly target.
