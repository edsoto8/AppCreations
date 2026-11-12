# Lab 4: Blazor 11

Pages: `/labs/blazor` (static SSR page with three InteractiveServer islands), `/labs/blazor/quickgrid` (InteractiveServer),
`/labs/blazor/quickgrid-static` (static SSR). Logic: `src/DotNet11Lab.Core/Labs/Blazor/` (component base classes live in
Core so the dashboard can show them as embedded, compiled code). Markup: `src/DotNet11Lab.Web/Components/Pages/Labs/Blazor/`.
Tests: `tests/DotNet11Lab.Tests/Lab4Blazor/` (Core data tests, bUnit component tests, HTTP-level page tests).

The dataset is 100,000 deterministic transactions (`TransactionDataset`, SplitMix64 generator, capped at 500,000), about
12% of which carry a note that makes their row taller.

---

## 1. Async form validation (Stable, new in 11)

**What's new.** `<DataAnnotationsValidator />` runs `AsyncValidationAttribute` and `IAsyncValidatableObject`. A field change
starts that field's async check; `EditForm` awaits all of them on submit, in any render mode. New `EditContext` members
(verified by compiling): `IsValidationPending()`, `IsValidationPending(in FieldIdentifier)`,
`IsValidationPending<T>(Expression<Func<T>>)`, the same three for `IsValidationFaulted`, `ValidateAsync(CancellationToken)`,
`RegisterAsyncFieldValidator(in FieldIdentifier, Func<CancellationToken, Task>)`; plus
`ValidationRequestedEventArgs.AddAsyncValidator(Func<CancellationToken, Task>)`.

**Example.** `SignupModel` with `[UsernameAvailable]`, `[EmailNotRegistered]` and an async invite-code rule;
`AsyncSignupFormBase.StateOf(field)` turns pending / faulted / valid into a badge. The `AccountDirectory` service waits
700 ms per lookup so the pending state is visible.

**Previous approach.** `LegacySignupFormBase`: sync attributes only; availability checked in `OnValidSubmit`, errors written
to a `ValidationMessageStore`, a hand-kept `Checking` flag, and manual clearing of stale errors on edit.

**Found while building (verified by a test).** The parameterless `IsValidationPending()` stays `false` while only a
field-level check is pending; the per-field overloads report it. The submit button therefore checks each async field.

**When not to use.** As a guarantee of uniqueness (enforce at write time; the demo's `TryRegister` does); for checks too
expensive to run on every field change.

Docs: [Asynchronous validation](https://learn.microsoft.com/aspnet/core/blazor/forms/validation-advanced?view=aspnetcore-11.0#asynchronous-validation).

## 2. QuickGrid URL navigation, QueryParameterNameOptions, OnRowClick (Stable, new in 11)

**What's new.** Sort column (by `Title`), direction and page live in the query string (`sort`, `direction`, `page`, 1-based);
headers and pager buttons render as `<a href>`. `QueryParameterNameOptions` (ctor takes a prefix, e.g. `new("m_")`) gives a
second grid its own parameters. `OnRowClick` (`EventCallback<TGridItem>`) adds the `row-clickable` class.

**Example.** `/labs/blazor/quickgrid` shows the live query string, e.g.
`?sort=Amount&direction=asc&page=2&m_sort=Total&m_direction=asc`. `/labs/blazor/quickgrid-static?page=3&sort=Amount&direction=desc`
renders that exact view with no circuit; a test checks the rows of page 3 and the `page=4` next link.

**Observed.** Sorting keeps the current `page` value rather than returning to page 1. Generic type inference for
`QuickGrid` failed when `OnRowClick` was bound to a `Task`-returning method group (CS1503); `TGridItem="Transaction"` fixes it.

**Breaking changes.** Multiple grids on one page need distinct `QueryParameterNameOptions` and separate `PaginationState`;
renaming a column title breaks bookmarked URLs; header/pager CSS selectors changed. Opt out with the AppContext switch
`Microsoft.AspNetCore.Components.QuickGrid.EnableUrlBasedQuickGridNavigationAndSorting`.

**Performance.** With `IQueryable` over an in-memory array, every page or sort click re-sorts 100,000 rows on the server;
use indexed database queries (or `ItemsProvider`) for real data.

Docs: [QuickGrid](https://learn.microsoft.com/aspnet/core/blazor/components/quickgrid?view=aspnetcore-11.0).

## 3. Virtualize: ScrollToItemAsync, InitialItemIndex, variable heights (Stable, new in 11)

**What's new.** `Virtualize<T>.ScrollToItemAsync(int, CancellationToken)`, `InitialItemIndex`, runtime-measured item heights,
`OverscanCount` default 3 → 15. (`QuickGrid` forwards `InitialItemIndex` / `ScrollToItemAsync` when `Virtualize="true"`.)

**Example.** `TransactionExplorerBase`: an `ItemsProvider` slicing the filtered list, a debounced (250 ms) background scan that
each keystroke cancels, `RefreshDataAsync()` + `ScrollToItemAsync(0)` after filtering, "jump to row N", and `?item=N` →
`InitialItemIndex`. A separate stats component shows provider calls, the last requested window and rows materialized (e.g.
43 rows requested for a 460 px viewport).

**Found while building.** With `ItemsProvider`, the Razor analyzer reports **BL0011** unless `ItemComparer` is set
(`EqualityComparer<Transaction>.Create(t => t?.Id ?? 0)` here); on `Virtualize` it raises no experimental diagnostic.

**When not to use.** Short lists; content that must be in the DOM for printing, SEO or in-page find.

Docs: [Virtualization](https://learn.microsoft.com/aspnet/core/blazor/components/virtualization?view=aspnetcore-11.0).

## 4. Render modes, persistent state, circuit-scoped state (Baseline)

- `/labs/blazor` has no render mode; `FormsIsland`, `TransactionExplorer` and `StateIsland` are rendered with
  `@rendermode="InteractiveServer"` and share one circuit. `RenderModeBadge` prints `RendererInfo.Name`
  (`Static` while prerendering, `Server` once interactive), `RendererInfo.IsInteractive` and the island root's
  `AssignedRenderMode` (`InteractiveServerRenderMode`).
- `[PersistentState]` (introduced in .NET 10) on `PersistedSummaryBase.Summary`: the prerendered value is restored, so the
  loader runs once per page view; `PlainSummaryBase` loads twice (the page shows process-wide counters; a test checks that
  prerendering alone adds one load to each).
- `BlazorLabState`, registered scoped, is one instance per circuit: pins from the explorer and QuickGrid and form submissions
  appear in the state island.

Docs: [Render modes](https://learn.microsoft.com/aspnet/core/blazor/components/render-modes?view=aspnetcore-11.0),
[Prerendered state persistence](https://learn.microsoft.com/aspnet/core/blazor/state-management/prerendered-state-persistence?view=aspnetcore-11.0),
[State management](https://learn.microsoft.com/aspnet/core/blazor/state-management?view=aspnetcore-11.0).
