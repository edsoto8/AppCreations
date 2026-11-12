# TaskFlow — Architecture

## The big picture

```
┌──────────────────────────── TaskFlow (Uno app, net10.0-desktop / net10.0-browserwasm) ─────────────────────┐
│  App.xaml.cs ──creates──► AppServices (composition root)                                                  │
│                                                                                                           │
│  Views/MainPage.xaml ──x:Bind──► MainViewModel          Services/FrameNavigationService  : INavigationService│
│  Views/EditTaskPage.xaml ─x:Bind─► EditTaskViewModel    Services/ContentDialogService    : IDialogService    │
│  Controls/PriorityBadge, Styles/*.xaml, Ui.cs           Services/ThemeService (UI only)                     │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                                │ project reference
┌───────────────────────────────── TaskFlow.Core (plain net10.0, no Uno) ───────────────────────────────────┐
│  ViewModels/  MainViewModel, TaskItemViewModel, EditTaskViewModel, Choice<T>                              │
│  Services/    TaskService ──► ITaskStore ◄── JsonTaskStore      INavigationService, IDialogService        │
│  Logic/       TaskQuery (filter/sort), TaskValidator, CollectionSync                                      │
│  Models/      TaskItem, TaskDraft, Priority                                                               │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▲
                          TaskFlow.Tests (xUnit v3) tests Core directly
```

**Dependency rule:** `TaskFlow.Core` depends only on CommunityToolkit.Mvvm and
Microsoft.Extensions.Logging.Abstractions. It never references Uno, XAML types, `Frame`, `ContentDialog`,
`Visibility` or brushes. The app references Core; tests reference Core.

## How a change flows

Completing a task, for example:

1. The user clicks a card's check box. Its `Command` is bound to `TaskItemViewModel.ToggleCompletedCommand`.
2. The command calls `MainViewModel.SetCompletedAsync`, which wraps the work in `RunAsync` (the error boundary).
3. `TaskService.SetCompletedAsync` changes the `TaskItem`, raises `Changed`, then saves through `ITaskStore`.
4. `MainViewModel` handles `Changed`: recomputes counts, re-applies `TaskQuery` (filter + sort), updates the
   `Tasks` collection in place with `CollectionSync`, and calls `Refresh()` on each item view model.
5. `x:Bind` bindings react to `PropertyChanged` / `CollectionChanged` and the UI updates.
6. If saving throws `TaskStoreException`, `RunAsync` shows the message in an error `InfoBar`.

The editor follows the same path through `TaskService.AddAsync` / `UpdateAsync`, then asks
`INavigationService.GoBack()`. Because both pages read the same `TaskService`, the list is already up to date
when the user comes back.

## Responsibilities

| Type | Responsibility |
|---|---|
| `TaskItem` | Stored data only. No notifications, no UI. |
| `TaskDraft` | What the user typed, before it becomes a task. Normalizes (trims) input. |
| `TaskValidator` | Every input rule. Used by the editor (messages) and by `TaskService` (guard). |
| `TaskQuery` | Pure filter + sort. |
| `TaskService` | Single source of truth: holds tasks, applies changes, raises `Changed`, saves; refuses to save if loading failed. |
| `JsonTaskStore` | File format, atomic save, corrupt-file recovery, repair of small problems. |
| `MainViewModel` | List state: visible tasks, filter/sort, counts, empty state, messages, page commands. |
| `TaskItemViewModel` | One card: display values (due text, overdue, labels) and row commands. |
| `EditTaskViewModel` | Form state, validation messages, Save/Cancel. Works on a copy, so Cancel is free. |
| `AppServices` | Creates and wires everything (manual constructor injection). |
| `FrameNavigationService` | `Frame.Navigate(typeof(EditTaskPage), id)` / `Frame.GoBack()`. |
| `ContentDialogService` | Shows confirmations as `ContentDialog`. |
| `ThemeService` | System/Light/Dark via `RequestedTheme` on the root `Frame`; remembers it in `LocalSettings`. |
| Pages (code-behind) | Pick the view model; purely visual behaviour (focus, theme button). Nothing else. |

## Decisions

| # | Decision | Why | Alternatives considered |
|---|---|---|---|
| 1 | Uno 7.0.5, `dotnet new unoapp -preset blank -presentation mvvm -markup xaml -theme fluent -nav blank -platforms desktop wasm` | Latest stable; the blank preset adds no extra frameworks, which keeps the generated code small enough to read | `recommended` preset (MVUX, Uno.Extensions navigation, DI hosting, Toolkit): powerful but too much at once for learning |
| 2 | One `net10.0-desktop` target for macOS, Windows and Linux | Uno's Skia desktop host covers all three from one build; `-platforms windows` (WinAppSDK) would add a second Windows head | WinAppSDK head: native WinUI, but Windows-only to build |
| 3 | View models in a separate plain `net10.0` library | Tests run anywhere without Uno; forces UI-free view models; reusable by future Android/iOS heads | View models inside the app project (the template default) with a test project referencing the app |
| 4 | CommunityToolkit.Mvvm partial properties (`[ObservableProperty] public partial ...`) and `[RelayCommand]` | Removes `INotifyPropertyChanged` boilerplate; the current recommended syntax for C# 13+ | Hand-written `SetProperty`; MVUX |
| 5 | `x:Bind` everywhere instead of `{Binding}` | Compile-time checked, faster, can call functions (`Ui.StrikeIf(...)`) instead of converters | `{Binding}` + `DataContext` + value converters |
| 6 | Plain `Frame` navigation behind `INavigationService` | The simplest navigation WinUI offers; the interface keeps `Frame` out of view models | Uno.Extensions region navigation |
| 7 | Hand-written composition root (`AppServices`) instead of a DI container | Five objects; manual wiring is easier to read and debug. Swapping in `Microsoft.Extensions.DependencyInjection` later is mechanical | Uno.Extensions.Hosting / DI container |
| 8 | `TaskService` as the single source of truth with a `Changed` event | The list and the editor never disagree; the main view model refreshes from one place | Passing results back through navigation; messaging |
| 9 | JSON with a version number, System.Text.Json source generation, enums as strings | Human-readable file; source generation keeps working when WebAssembly trims code; the version allows future migrations | SQLite (out of scope); reflection-based serializer |
| 10 | Atomic save (temp file + `File.Move(..., overwrite: true)`) and one save at a time | A crash mid-write never destroys the previous file; overlapping saves can't interleave | Writing the file in place |
| 11 | Corrupt file → rename to `tasks.corrupt-*.json`, start empty, warn. Unreadable file → disable saving | Never silently lose or overwrite user data | Crashing; silently starting empty and overwriting |
| 12 | Data folder from `ApplicationData.Current.LocalFolder` (+ `TASKFLOW_DATA_DIR` override) | Works on every Uno target; on WebAssembly it is persisted to IndexedDB | `Environment.SpecialFolder.LocalApplicationData` (not persisted on WebAssembly) |
| 13 | `TimeProvider` injected for "today" and `CreatedAt` | Date-dependent rules (overdue, "Due today") are testable with a fixed clock | `DateTime.Now` scattered through the code |
| 14 | Theme switching in a small app-side `ThemeService` using `RequestedTheme` | Pure UI concern, no extra package | `-theme-service` (Uno.Extensions) or Uno.Toolkit's `SystemThemeHelper` |
| 15 | Fluent theme + our own `ThemeDictionaries` for priority colours | Fluent is Uno's default WinUI look; only a handful of custom colours needed | Material theme (extra package and its own conventions) |
| 16 | xUnit v3 on Microsoft.Testing.Platform (`global.json` `"test": { "runner": ... }`) | The .NET 10 SDK's new `dotnet test`; xUnit v3 4.x requires it | VSTest with xUnit v3 3.x |
| 17 | Logging: `ILogger<T>` in Core (abstractions only), console output in Debug via the template's factory | Built-in .NET logging, no third-party sink; Release skips logging for startup speed (template default) | Serilog |

## Adding Android or iOS later

1. Add the target to `TargetFrameworks` in `TaskFlow/TaskFlow.csproj` (for example `net10.0-android;net10.0-ios`)
   and install the workloads (`uno-check` does this).
2. Nothing in `TaskFlow.Core` changes. `ApplicationData.LocalFolder` already maps to each platform's sandbox.
3. Check the layout at phone width (the Narrow visual state already handles it) and the on-screen keyboard.

## Known limitations

- With a forced Light/Dark theme, the dim layer behind a `ContentDialog` keeps the system theme's tint (the dialog
  itself is themed correctly).
- Keyboard shortcuts use Control on every platform (Command on macOS is not mapped).
- Saving rewrites the whole file on each change. Fine for hundreds or thousands of tasks; a database would be the
  next step for far more.
