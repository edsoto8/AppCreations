# Learning Uno Platform with TaskFlow

This guide follows the order TaskFlow was built in. Each milestone has the same five parts:
**What we built**, **What you learned**, **Important files**, **Code walkthrough** and **Try it yourself**.
Build and test results for each milestone are in [PROGRESS.md](PROGRESS.md).

You already know C# and .NET. The comparisons below map Uno ideas onto things you have seen in WPF, WinForms,
ASP.NET or console apps.

---

## Milestone 1 — Environment and first application

### What we built
A new Uno solution from the official template, building for desktop (`net10.0-desktop`) and the browser
(`net10.0-browserwasm`), and launched to show "Hello Uno Platform!".

### What you learned

**What Uno Platform is.** Uno is an open-source implementation of the **WinUI 3** API (Microsoft's current
Windows UI framework) that runs on macOS, Linux, Windows, WebAssembly, Android and iOS. You write WinUI-style XAML
and C#, and the same code runs everywhere. If you search for help, WinUI documentation usually applies
directly — the types (`Grid`, `Button`, `Frame`, `ContentDialog`…) are the same.

**How Uno draws the UI.** Since Uno 7 every platform uses the **Skia renderer**: Uno lays out and *draws* every
control itself onto a hardware-accelerated canvas (Metal on macOS, OpenGL/Vulkan on Linux and Windows, WebGL in the
browser) inside a thin native window. So the app looks pixel-identical on every platform. Think of it as a game
engine for business UI. (The optional WinAppSDK target is the exception: there Microsoft's own WinUI does the
drawing.)

**Uno vs .NET MAUI.**

| | Uno Platform | .NET MAUI |
|---|---|---|
| API | WinUI 3 XAML | MAUI's own XAML (Xamarin.Forms lineage) |
| Rendering | Draws everything itself (Skia) → identical everywhere | Wraps each platform's native controls → native look per platform |
| Platforms | Windows, macOS, **Linux**, **WebAssembly**, iOS, Android | Windows, macOS (Catalyst), iOS, Android |
| When it shines | Same UI everywhere, web + Linux, WinUI skills reuse | Native look and feel per platform |

**What XAML is.** XAML is XML that describes an object tree. `<Button Content="Add" />` is just
`new Button { Content = "Add" }`. The compiler turns each `.xaml` file into C# that builds that tree; your
`.xaml.cs` "code-behind" is the other half of the same `partial class`.

**The project structure.**

- `TaskFlow.csproj` uses **`Uno.Sdk`** (`<Project Sdk="Uno.Sdk">`). The version is pinned in `global.json`, and
  the SDK picks every Uno package version for you — like a framework reference instead of many NuGet packages.
- **Single project**: one project, many targets. `<TargetFrameworks>net10.0-browserwasm;net10.0-desktop</...>`.
  Platform-specific start-up lives in `Platforms/Desktop/Program.cs` and `Platforms/WebAssembly/Program.cs`.
- **`UnoFeatures`** turns on optional parts (Material, Toolkit, Mvvm, Navigation…). TaskFlow only needs `Skia`.
- `App.xaml(.cs)` is the application object (like `Program.cs` + `App` in WPF). `OnLaunched` creates the `Window`,
  puts a `Frame` in it and navigates to the first page.

### Important files
| File | Role |
|---|---|
| `global.json` | Uno.Sdk version; test runner choice |
| `TaskFlow/TaskFlow.csproj` | Targets and Uno features |
| `TaskFlow/Platforms/Desktop/Program.cs` | Desktop entry point: picks X11 / macOS / Win32 host |
| `TaskFlow/App.xaml.cs` | Creates the window and frame; navigates to `MainPage` |

### Code walkthrough
```csharp
var host = UnoPlatformHostBuilder.Create()
    .App(() => new App())
    .UseX11()             // Linux desktop
    .UseLinuxFrameBuffer()// Linux without a desktop (kiosks)
    .UseMacOS()           // macOS
    .UseWin32()           // Windows
    .Build();
host.Run();
```
One desktop build contains every host; at start-up Uno uses the first one that works on the current OS. That is
why the same `net10.0-desktop` output runs on your Mac and on Windows.

### Try it yourself
1. Change the window title: in `App.OnLaunched`, set `MainWindow.Title = "My TaskFlow";` and run the app.
2. Run the WebAssembly target (`dotnet run --project TaskFlow -f net10.0-browserwasm`) and open the browser's dev
   tools. Notice the page is a single `<canvas>` — Uno draws everything itself.

---

## Milestone 2 — First user interface

### What we built
The first `MainPage`: title, Add Task button, completed counter and a list of in-memory sample tasks, driven by a
`Click` event handler.

### What you learned
- **`Grid`** divides space into rows/columns. `Height="Auto"` = size to content, `Height="*"` = take what's left.
  `RowSpacing`/`ColumnSpacing` add gaps without margins on every child.
- **`StackPanel`** stacks children vertically or horizontally (`Orientation`, `Spacing`).
- **`TextBlock`** shows text; **`Button`** raises `Click`.
- **`ListView` + `DataTemplate`**: the template describes *one* item; the list repeats it for every item in
  `ItemsSource`. `ItemsRepeater` is the lower-level alternative when you want full control and no built-in
  selection or scrolling.
- **XAML properties**: attributes set simple values (`FontSize="32"`); *attached properties* like `Grid.Row="1"`
  are set on a child but read by its parent.
- **Events vs commands**: a `Click` handler lives in code-behind and must update every affected control by hand
  (`UpdateCounter()`). A command (Milestone 3) lives in a view model, and the UI updates itself through bindings.

### Important files
`Views/MainPage.xaml` (layout) and, in the Milestone 2 commit, `MainPage.xaml.cs` (event handler).
Run `git show e2e0b5d` to see that version.

### Code walkthrough
```csharp
private void AddTaskButton_Click(object sender, RoutedEventArgs e)
{
    _tasks.Add(new TaskItem { Title = $"New task {_tasks.Count + 1}" });
    UpdateCounter(); // With events we must remember to refresh every dependent piece of UI by hand.
}
```
The list updated by itself because `_tasks` is an `ObservableCollection` (it raises `CollectionChanged`). The
counter did not, because a `TextBlock` has no idea it depends on the list. That gap is what MVVM closes.

### Try it yourself
1. Add a third grid column to the header with a "Clear" button that empties the sample list (use `git show e2e0b5d`
   as a starting point in a scratch branch).
2. In the `DataTemplate`, show the priority in bold red when it is High. (Hint: you'll find this awkward with
   events — Milestone 6 solves it properly with a reusable control.)

---

## Milestone 3 — MVVM and data binding

### What we built
`TaskFlow.Core` with `TaskService` (the data), `TaskQuery` (filter/sort) and three view models built with
CommunityToolkit.Mvvm; `MainPage` rewritten to bind to `MainViewModel`; the first xUnit tests.

### What you learned
- **Model / View / ViewModel**: the *model* is plain data (`TaskItem`); the *view* is XAML (`MainPage`); the
  *view model* is a plain C# class with the state and commands the view needs (`MainViewModel`). The view model
  never touches a control, so you can unit-test it like any other class.
- **Binding** connects a control property to a view-model property. TaskFlow uses **`x:Bind`**: compiled,
  type-checked, faster than `{Binding}`. Its default mode is `OneTime`, so add `Mode=OneWay` for values that change
  and `Mode=TwoWay` for inputs.
- **`DataContext`** is what `{Binding}` resolves against (inherited down the tree). `x:Bind` doesn't use it: it
  binds against the page's own properties — that's why each page has a `ViewModel` property.
- **`INotifyPropertyChanged`** is how a binding learns a value changed. **`ObservableCollection<T>`** is the
  collection version (`CollectionChanged`).
- **`ICommand`** is "something a button can execute", with `CanExecute` controlling whether it's enabled.
- **CommunityToolkit.Mvvm** writes the boilerplate with source generators: `[ObservableProperty]` creates a
  notifying property, `[RelayCommand]` creates an `ICommand` property from a method.

### Important files
| File | Role |
|---|---|
| `TaskFlow.Core/Services/TaskService.cs` | Single source of truth; raises `Changed` |
| `TaskFlow.Core/Logic/TaskQuery.cs` | Pure filter and sort |
| `TaskFlow.Core/ViewModels/MainViewModel.cs` | List state, counts, filter/sort, page commands |
| `TaskFlow.Core/ViewModels/TaskItemViewModel.cs` | One card; row commands |
| `TaskFlow/AppServices.cs` | Creates and wires everything |

### Code walkthrough
```csharp
[ObservableProperty]
public partial Choice<TaskFilter> SelectedFilter { get; set; }

partial void OnSelectedFilterChanged(Choice<TaskFilter> value) => Refresh();
```
The generator writes the property body (compare, set, raise `PropertyChanged`) and calls
`OnSelectedFilterChanged` after a change. In XAML,
`SelectedItem="{x:Bind ViewModel.SelectedFilter, Mode=TwoWay}"` means: when the user picks a filter, the property
is set, `Refresh()` runs, `Tasks` changes, and the list redraws — no event handlers anywhere.

```csharp
[RelayCommand]
private Task ToggleCompletedAsync() => _owner.SetCompletedAsync(this, !Model.IsCompleted);
```
`[RelayCommand]` turns this into a public `ToggleCompletedCommand` (an `IAsyncRelayCommand`). The check box binds
`Command="{x:Bind ToggleCompletedCommand}"`. While the async command runs, it can't be started twice.

### Try it yourself
1. Add a `RemainingText` property to `MainViewModel` ("3 left") and show it under the summary. Remember
   `OnPropertyChanged(nameof(RemainingText))` in `Refresh()`. Write a test first in `MainViewModelTests`.
2. Add a "Title" sort option to `TaskSortOrder` and `TaskQuery`, plus a test in `TaskQueryTests`. The ComboBox
   picks it up with no XAML change — why?

---

## Milestone 4 — Task editing and navigation

### What we built
`EditTaskPage` + `EditTaskViewModel` (title, description, due date, priority, Save/Cancel, validation),
navigation with `Frame`, and a delete confirmation dialog.

### What you learned
- **Page navigation**: `Frame.Navigate(typeof(EditTaskPage), taskId)` pushes a page and passes a parameter, which
  arrives in `OnNavigatedTo(e)` as `e.Parameter`; `Frame.GoBack()` pops it. `NavigationCacheMode.Required` keeps
  `MainPage` alive so going back keeps its scroll position.
- **Keeping navigation out of view models**: view models call `INavigationService`; the app implements it with
  `Frame`, tests use a fake that records calls. Same idea for dialogs (`IDialogService` → `ContentDialog`).
- **Forms and two-way binding**: `Text="{x:Bind ViewModel.Title, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"`
  updates the view model on every keystroke (the default is when focus leaves).
- **Validation**: rules live in one pure class (`TaskValidator`). The editor shows its messages; `TaskService`
  calls it again as a guard so invalid data can never be stored, whatever the UI does.
- **Working copy**: the editor copies the task's values into its own properties. Cancel just navigates back — no
  undo logic needed.
- **Reusable components**: the same editor page and view model handle both "new" and "edit" (`taskId` null or not).

### Important files
`Views/EditTaskPage.xaml(.cs)`, `ViewModels/EditTaskViewModel.cs`, `Logic/TaskValidator.cs`,
`Services/INavigationService.cs` + `TaskFlow/Services/FrameNavigationService.cs`,
`Services/IDialogService.cs` + `TaskFlow/Services/ContentDialogService.cs`.

### Code walkthrough
```csharp
protected override void OnNavigatedTo(NavigationEventArgs e)
{
    base.OnNavigatedTo(e);
    ViewModel = App.Services.CreateEditTaskViewModel(e.Parameter as Guid?);
    Bindings.Update(); // ViewModel was replaced after InitializeComponent: re-read every x:Bind
}
```
`x:Bind` evaluates when the page loads. Because `ViewModel` is assigned later than `InitializeComponent`,
`Bindings.Update()` tells the generated binding code to read everything again.

```csharp
var dialog = new ContentDialog
{
    Title = title, Content = message,
    PrimaryButtonText = confirmText, CloseButtonText = "Cancel",
    DefaultButton = ContentDialogButton.Close, // Enter cancels: no accidental deletes
    XamlRoot = xamlRoot(),                      // which window to show in
};
return await dialog.ShowAsync() == ContentDialogResult.Primary;
```

### Try it yourself
1. Add a live character counter under the title ("12 / 100"). Add a `TitleLengthText` property updated in
   `OnTitleChanged`.
2. Make the editor warn when the due date is in the past (a warning, not an error — saving still works). Put the
   rule in `TaskValidator` and test it.

---

## Milestone 5 — Local data storage

### What we built
`JsonTaskStore` saves tasks to `tasks.json` in the app's data folder after every change and loads them at start-up,
recovering from missing, damaged or unreadable files without losing data.

### What you learned
- **JSON serialization** with `System.Text.Json`. TaskFlow uses **source generation** (`TaskJsonContext`): the
  serializer code is generated at compile time, which is faster and keeps working when the WebAssembly build trims
  unused code (reflection-based serialization can break there).
- **Async/await for file I/O**: `await JsonSerializer.SerializeAsync(stream, ...)` keeps the UI responsive. View
  models await services; only the framework-called `OnLaunched` is `async void`, and it catches everything.
- **Service abstraction**: `TaskService` talks to `ITaskStore`, so tests use an in-memory `FakeTaskStore` that can
  pretend the disk is full.
- **Safe file writes**: write to `tasks.json.tmp`, then `File.Move(tmp, path, overwrite: true)`. A crash never
  leaves a half-written file.
- **Never lose data**: unreadable files are renamed to `tasks.corrupt-<timestamp>.json`; one bad entry is skipped
  (with a backup) instead of discarding everything; a file that can't be read at all disables saving; a failed save
  is undone in memory so the screen matches the disk.
- **Platform considerations**: `ApplicationData.Current.LocalFolder` is the per-app folder on every platform. On
  desktop it's a normal folder; on WebAssembly it's an in-browser file system persisted to IndexedDB (awaiting a
  `StorageFolder` call first makes sure it is ready).

### Important files
`TaskFlow.Core/Services/JsonTaskStore.cs`, `ITaskStore.cs`, `TaskService.cs`, `TaskFlow/AppServices.cs`.

### Code walkthrough
```csharp
private async Task CommitAsync(Action undo)
{
    OnChanged();                                           // show the change immediately
    var snapshot = _tasks.Select(t => t.Clone()).ToList(); // copy, so later edits can't leak into this save
    await _saveLock.WaitAsync();                           // one save at a time
    try { await _store.SaveAsync(snapshot); }
    catch (TaskStoreException) { undo(); OnChanged(); throw; } // keep memory == disk
    finally { _saveLock.Release(); }
}
```
Every mutation (`AddAsync`, `UpdateAsync`, …) changes memory, then calls `CommitAsync` with a small lambda that
reverses that change. The view model's `RunAsync` catches the exception and shows it in an `InfoBar`.

### Try it yourself
1. Open your `tasks.json` in an editor (path in README), change a title, and restart the app. Then delete a closing
   brace and restart — find the `.corrupt-` backup.
2. Add an "Export…" idea in miniature: a test that saves three tasks with `JsonTaskStore`, reads the file with
   `JsonDocument`, and asserts there are three elements under `tasks`.

---

## Milestone 6 — UI improvements

### What we built
Task cards, colour-coded priority badges, overdue highlighting, a completion bar, an empty state, a loading ring,
Light/Dark/System theme switching, a responsive layout and accessibility names.

### What you learned
- **Resource dictionaries**: named, reusable objects (brushes, numbers, styles) in `Styles/*.xaml`, merged into
  `App.xaml` so every page can use them.
- **`{StaticResource}` vs `{ThemeResource}`**: `StaticResource` is looked up once. `ThemeResource` is re-evaluated
  when the theme changes. Theme-specific values live in `ThemeDictionaries` with `Light` and `Dark` keys — define
  every key in both.
- **Styles**: `<Style TargetType="TextBlock">` bundles setters; `BasedOn` extends an existing style
  (`IconButtonStyle` builds on `DefaultButtonStyle`).
- **Reusable components**: `PriorityBadge` is a `UserControl` with a **dependency property** (a property the XAML
  engine can bind and style) and **visual states** that restyle it per priority.
- **Responsive layout**: `VisualStateManager` + `AdaptiveTrigger MinWindowWidth="720"`. The XAML describes the
  narrow layout; the Wide state's `Setter`s move controls (`SortBox.(Grid.Row)`) and show labels.
- **x:Bind functions replace converters**: `TextDecorations="{x:Bind local:Ui.StrikeIf(IsCompleted), Mode=OneWay}"`.
- **Themes at runtime**: set `RequestedTheme` on the root element; popups (dialogs) need it set explicitly.
- **Accessibility**: `AutomationProperties.Name` on every icon-only button, tooltips, keyboard accelerators
  (Ctrl+N, Ctrl+S, Esc), and moving focus to the first field.

### Important files
`Styles/Theme.xaml`, `Styles/Styles.xaml`, `Controls/PriorityBadge.xaml(.cs)`, `Ui.cs`,
`Services/ThemeService.cs`, `Views/MainPage.xaml`.

### Code walkthrough
```csharp
public static readonly DependencyProperty PriorityProperty = DependencyProperty.Register(
    nameof(Priority), typeof(Priority), typeof(PriorityBadge),
    new PropertyMetadata(Priority.Medium, (d, _) => ((PriorityBadge)d).UpdateState()));

private void UpdateState()
{
    Label.Text = Priority.ToString();
    VisualStateManager.GoToState(this, Priority.ToString(), useTransitions: false);
}
```
When a binding sets `Priority`, the callback switches to the "High", "Medium" or "Low" visual state, whose setters
use `{ThemeResource ...}` brushes — so the badge is also correct after a theme switch.

### Try it yourself
1. Add a fourth colour key `AccentStripeBrush` to both theme dictionaries and use it as a 4px left border on cards
   for High-priority tasks only. (Hint: another visual state, or an x:Bind function returning a `Thickness`.)
2. Add a third `AdaptiveTrigger` state at 1100px that shows descriptions with `MaxLines="4"` instead of 2.

---

## Milestone 7 — Testing and code quality

### What we built
96 xUnit tests over `TaskFlow.Core`, an independent code review, and fixes (each with a regression test) for every
issue it found.

### What you learned
- **Why the Core split pays off**: every rule, view model and the JSON store are tested without starting Uno, in
  about a second.
- **Test doubles**: `FakeTaskStore` (can fail saves/loads), `FakeNavigation`, `FakeDialogs`, and
  `FixedTimeProvider` — injecting `TimeProvider` makes date rules ("Due today", overdue) deterministic.
- **Real files in temp folders** for `JsonTaskStore` tests (`TempFolder`) — more trustworthy than mocking `File`.
- **Testing failure paths** found the most important bugs (duplicate after failed save, data loss while loading).

Running tests:
```bash
dotnet test                                        # everything
dotnet test --project TaskFlow.Tests -- --filter-class TaskFlow.Tests.TaskQueryTests   # one class
```
Reading results: `total / failed / succeeded`. A failure prints the test name, the `Assert` that failed with
*Expected* vs *Actual*, and the file/line. The exit code is non-zero on failure, so CI fails too.

### Important files
`TaskFlow.Tests/*Tests.cs`, `TaskFlow.Tests/TestSupport.cs`.

### Code walkthrough
```csharp
[Fact]
public async Task RetryAfterFailedSave_AddsTheTaskOnlyOnce()
{
    var store = new FakeTaskStore { FailSaves = true };
    var service = Services.LoadedTaskService(store);
    var vm = new EditTaskViewModel(service, _navigation, null) { Title = "Buy milk" };

    await vm.SaveCommand.ExecuteAsync(null);   // disk "full"
    Assert.Empty(service.Tasks);               // rolled back

    store.FailSaves = false;
    await vm.SaveCommand.ExecuteAsync(null);   // retry
    Assert.Single(store.Saved);                // exactly one task, not two
}
```
Arrange (fake store that fails) → act (save, then retry) → assert. The test names the behaviour, not the method.

### Try it yourself
1. Write a test proving that deleting a *completed* task lowers both `TotalCount` and `CompletedCount`.
2. Break something on purpose (e.g. reverse the sort in `TaskQuery`), run `dotnet test`, read the failure output,
   then fix it.

---

## Milestone 8 — Final review

### What we did
Clean builds of desktop (Debug and Release) and WebAssembly with zero warnings, all tests passing, dependency
audit (Core uses only CommunityToolkit.Mvvm and Microsoft.Extensions.Logging.Abstractions), a check that Core
references no UI types, and end-to-end runs of the desktop (Linux) and WebAssembly (Chromium) apps.

### What you learned
- `TreatWarningsAsErrors` keeps the codebase honest — including Uno's analyzer that flags APIs not implemented on a
  platform.
- "Tested" means *run and observed*. PROGRESS.md lists exactly what was verified and what wasn't (for example, the
  app was not run on a real Mac or Windows machine during development).

### Try it yourself
1. Run the app on your Mac: `dotnet run --project TaskFlow -f net10.0-desktop`. Check the log line for where
   tasks are stored and compare with the README table.
2. Add `-c Release` and notice the Hot Design toolbar disappears and start-up is faster. Find the `#if DEBUG` that
   causes both in `App.xaml.cs`.

---

## Where to go next

Five follow-up features, roughly in order of difficulty:

1. **Search box** — filter by text in title/description. Practise: `TextBox` two-way binding, extending
   `TaskQuery`, tests.
2. **Undo delete** — show an `InfoBar` with "Undo" for a few seconds after deleting. Practise: commands with
   parameters, `DispatcherTimer`, `TaskService` API design.
3. **Tags or categories** — a list of tags per task with a tag filter. Practise: model evolution and JSON file
   version 2 with a migration in `JsonTaskStore`.
4. **Due-date reminders** — a desktop notification when a task becomes due. Practise: platform-specific code
   (`#if`), checking Uno's feature support before using an API.
5. **Android or iOS head** — add `net10.0-android` to the targets and run on an emulator. Practise: mobile
   layout, the on-screen keyboard, and seeing how little changes because logic lives in `TaskFlow.Core`.

Further reading (official docs): *How Uno works*, *Using the Uno.Sdk*, *Working with themes*,
*ApplicationData*, *Using Skia Desktop* — all under https://platform.uno/docs/.
