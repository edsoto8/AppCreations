# BoardFlow --- Progress Tracker

Last updated: 2026-10-06 (session 1)

## Status Legend

-   `[ ]` Not started
-   `[~]` In progress / partially complete
-   `[x]` Verified complete
-   `[!]` Blocked

## Required Milestones

-   [x] Milestone 1 --- Foundation
-   [x] Milestone 2 --- Workspaces and Boards
-   [x] Milestone 3 --- Columns
-   [x] Milestone 4 --- Cards
-   [x] Milestone 5 --- Drag, Drop, and Ordering
-   [x] Milestone 6 --- Persistence and Data Integrity
-   [x] Milestone 7 --- Search and Filtering
-   [x] Milestone 8 --- Productivity Features
-   [x] Milestone 9 --- Polish and Resilience
-   [x] Milestone 10 --- Final Validation and Handoff

## Current Milestone

**Milestone:** All required milestones complete. Next: stretch goals (none started).\
**Status:** MVP done per the Definition of Done in `SPEC.md`.

## Acceptance Criteria — Evidence

Evidence names are test classes (`tests/BoardFlow.Tests` = Core/Data, `tests/BoardFlow.App.Tests`
= view models and headless UI driving the real window) or the manual checks listed in the
verification history.

### Milestone 1 --- Foundation

- [x] Entire solution builds without errors — `dotnet build`: 0 warnings, 0 errors (warnings are errors).
- [x] Application launches successfully — real app run under Xvfb (screenshots of welcome screen and
      board); log shows `Main window ready`. Headless: `BoardInteractionTests.WelcomeScreen_Renders`.
- [x] SQLite database is created automatically — `DatabaseInitializerTests.NewFile_IsCreatedAtLatestVersion`,
      `NewFile_InMissingFolder_CreatesTheFolder`; real run created `boardflow.db`.
- [x] Dapper is used for persistence; EF Core is not introduced — `BoardFlow.Data.csproj` references
      Dapper + Microsoft.Data.Sqlite only.
- [x] Serilog configured, startup/application errors logged — `Infrastructure/Logging.cs`, `Program.cs`
      (fatal + unhandled + unobserved handlers), `AppSession` (UI-thread handler). A real start-up DI
      failure during development was captured in the log with full stack trace.
      `ResilienceTests.FailedWrite_ShowsUserMessage_LogsIt_AndKeepsData` asserts a failed write is in the log.
- [x] Automated test project runs successfully — see verification history.
- [x] README contains working commands for build, test and run — commands in `README.md` were the
      ones used for every verification below.

### Milestone 2 --- Workspaces and Boards

- [x] Create a workspace and at least two boards — `WorkspaceAndBoardTests.CreateWorkspaceAndTwoBoards_…`.
- [x] Switching boards shows the correct board — same test (switches both ways, checks name and columns).
- [x] Restart preserves workspaces and boards (and reopens the last board) — same test plus
      `RenameWorkspaceAndEditBoard_Persist`; repository tests with `Reopen()`.
- [x] Destructive operations require confirmation — `DeleteBoard_RequiresConfirmation`,
      `DeleteWorkspace_RequiresConfirmation_ThenRemovesEverything` (cancel keeps data, confirm deletes).
- [x] Business logic has automated tests — `WorkspaceRepositoryTests`, `BoardRepositoryTests`, `ValidateTests`.

### Milestone 3 --- Columns

- [x] Multiple columns on a board — default columns + `ColumnWorkflowTests.AddRenameAndReorderColumns_SurviveRestart`.
- [x] Columns can be reordered — menu (Move left/right) and header drag
      (`BoardInteractionTests.DraggingColumnHeader_ReordersColumns`); `ColumnRepositoryTests.Move*`.
- [x] Column order survives restart — `AddRenameAndReorderColumns_SurviveRestart`, repository `Reopen` tests.
- [x] Deleting a non-empty column never silently destroys cards — repository refuses by default;
      dialog defaults to moving cards (`DeleteNonEmptyColumn_DefaultsToMovingCards`, archived cards
      move too); deleting cards needs an explicit choice (`DeleteNonEmptyColumn_WithCards_OnlyWhenExplicitlyChosen`).
- [x] Column behaviour covered by tests — `ColumnRepositoryTests`, `ColumnWorkflowTests`.

### Milestone 4 --- Cards

- [x] Create a card and edit every field — `CardWorkflowTests.CreateCardWithEveryField_…`,
      `EditEveryField_ThenClearOptionalOnes` (title, description, priority, due date, labels, column).
- [x] Saved card shows the same values after restart — `CreateCardWithEveryField_ShowsSameValuesAfterRestart`.
- [x] Archived cards hidden and restorable — `ArchiveFromEditor_HidesCard_ArchiveBrowserRestoresIt`,
      `CardRepositoryTests` archive/restore tests.
- [x] Validation prevents invalid required data — `BlankTitle_IsRejectedInline_AndNothingIsWritten`,
      `ValidateTests`, repository validation tests; schema CHECK constraints (`SchemaIntegrityTests`).
- [x] Card CRUD and persistence tested — `CardRepositoryTests`, `CardWorkflowTests`.
- Decision: descriptions are **plain text** (spec allows either), so Markdown rendering does not apply.

### Milestone 5 --- Drag, Drop, and Ordering

- [x] Card moves between columns — `BoardInteractionTests.DraggingCardToAnotherColumn_MovesAndPersists`
      (simulated mouse on the real window) and a real X11 run with `xdotool`.
- [x] Multiple cards reorder predictably — `DraggingCardWithinColumn_Reorders`, keyboard
      `KeyboardShortcuts_MoveFocusedCard`, `CardRepositoryTests.Move*`.
- [x] New positions survive restart — drag test restarts the session; real X11 run restarted the process.
- [x] Rapid moves do not duplicate or lose cards — `CardRepositoryTests` 500-move stress test against
      an independent model; `CardWorkflowTests.RapidMoves_NeverDuplicateOrLoseCards` (200 moves via view model).
- [x] Ordering logic tested independently of UI — `OrderingTests` (incl. random permutation property test).
- Column reorder: drag-and-drop on the column header **and** menu alternative.

### Milestone 6 --- Persistence and Data Integrity

- [x] Close/reopen preserves all normal data — restart tests across workspaces, boards, columns,
      cards (all fields), labels, archive state, ordering, last-open board.
- [x] Relationships stay valid — foreign keys on every connection with cascades
      (`SchemaIntegrityTests`), cross-board moves and foreign labels rejected (`CardRepositoryTests`).
- [x] Failed writes produce a useful error and are logged — `ResilienceTests.FailedWrite_…`.
- [x] Important persistence paths tested — 9 Data test classes.
- [x] Never silently resets/replaces a valid database — newer schema, corrupt file, and foreign SQLite
      file all refuse with the file byte-for-byte unchanged (`DatabaseInitializerTests`,
      `ResilienceTests.CorruptDatabase_ShowsErrorWindow_AndLeavesFileUntouched`); backup via
      `VACUUM INTO` before any upgrade; failed migration rolls back.

### Milestone 7 --- Search and Filtering

- [x] Search returns relevant cards from the active board — `FilterAndLabelTests.Search_…`, `CardFilterTests`.
- [x] Filters update results correctly (priority, label, column, due state incl. overdue, combined) —
      `CombinedFilters_ThenClear_…`, `DueFilters_…`, `ColumnFilter_…`, `CardFilterTests`.
- [x] Clearing filters restores the full view — `CombinedFilters_ThenClear_RestoresFullBoard`.
- [x] Search/filter logic tested — `CardFilterTests` (Core) and `FilterAndLabelTests` (view model).

### Milestone 8 --- Productivity Features

- [x] Quick-add with minimal interaction — Ctrl+N → type → Enter (`CtrlF_FocusesSearch_AndCtrlN_OpensQuickAdd`
      on the real window; verified again on real X11 with `xdotool`).
- [x] Duplicate creates a distinct persisted card — `Duplicate_CreatesDistinctPersistedCardBelowOriginal_AndOpensIt`.
- [x] Archive browser restores cards — `ArchiveFromEditor_HidesCard_ArchiveBrowserRestoresIt`,
      `DeleteFromArchive_AsksThenDeletesPermanently`.
- [x] Shortcuts documented (README) and working — Ctrl+N, Ctrl+F, Escape (`ClickingCard_OpensEditor_AndEscapeClosesIt`),
      Enter/Escape in dialogs, Ctrl+Enter save, Ctrl+arrows move cards (`KeyboardShortcuts_MoveFocusedCard`).
- [x] Useful empty states — welcome, no boards, no columns, empty column, no filter matches, empty archive, no labels.
- [x] Card detail panel — `CardEditorView` (side panel with unsaved-changes guard).

### Milestone 9 --- Polish and Resilience

- [x] Normal workflows produce no unhandled exceptions — all workflow/UI tests run the real view
      models and window; UI-thread handler logs and reports anything unexpected without closing.
- [x] Usable at common sizes — minimum 960×600 enforced; `MinimumWindowSize_StillShowsBoardAndHeader`
      screenshot; columns scroll horizontally.
- [x] Errors understandable to users, detailed in logs — repository messages ("Could not move the card.
      Your previous data is unchanged."), stale-data refresh (`StaleCard_IsReportedAndBoardRefreshes`).
- [x] Empty boards/workspaces look intentional — reviewed screenshots of each empty state.
- [x] Consistent styling — own palette, control themes and typography (`Styles/Theme.axaml`);
      distinct logo/identity (no Trello branding).
- Accessibility names on icon buttons, cards (summarised), inputs; keyboard navigation and card moves;
  focus is kept inside open dialogs/panels and restored when they close (`ReviewRegressionUiTests`).
- Busy indicators: not added — every operation is a sub-millisecond local SQLite call (decision below).

### Milestone 10 --- Final Validation and Handoff

- [x] Clean build succeeds — all `bin/` and `obj/` deleted, `dotnet restore` + `dotnet build`: 0 warnings, 0 errors.
- [x] Full test suite passes — 348/348 (299 Core/Data + 49 App), also under `TZ=America/Los_Angeles`
      with a Turkish locale (`tr_TR`) to catch time-zone and culture bugs.
- [x] README describes the actual implementation (commands re-run, shortcuts, decisions, limitations).
- [x] PROGRESS.md reflects reality (this file); every criterion above was checked against a test or a
      recorded manual run.
- [x] Independent review performed and every finding addressed (below).
- [x] SCORECARD.md completed.

## Independent Review (Milestone 10)

A fresh Opus sub-agent reviewed the code read-only against SPEC.md and verified its findings with
throwaway tests. All findings were fixed by the lead, each with a regression test
(`Data/ReviewRegressionTests`, `Ui/ReviewRegressionUiTests`). The five view-layer regression tests were
confirmed to **fail** against the pre-fix code before the fix was restored.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Enter on a focused **Cancel** confirmed destructive dialogs (data loss); Tab escaped dialogs | Enter only confirms from a single-line text box; destructive dialogs open with Cancel focused; Tab trapped in dialog/panel; focus restored on close |
| 2 | Medium | Lost pointer capture left a "stuck" drag that dropped on the next click | Override `OnPointerCaptureLost` (direct event); cancel when a move arrives without the button or a new press starts |
| 3 | Medium | Dapper ignored the DateTime handler on write; times read back shifted by the UTC offset | Remove Dapper's built-in DateTime map so the handler writes ISO-8601 `Z` text; parse with AssumeUniversal (reads both formats) |
| 4 | Low-Med | Ctrl+↑/↓ with a filter swapped with hidden cards (no visible change) | Neighbour taken from the visible list |
| 5 | Low-Med | Switching board with unsaved edits could strand the editor | Await panel close; restore selection if the user keeps editing |
| 6 | Low | Two repository calls outside the error boundary | Wrapped in `Try` |
| 7 | Low | Unwritable data folder crashed instead of showing the start-up error | IO errors → `PersistenceException`; `AppSession` shows the error window for any start-up failure |
| 8 | Low | Card save and column change were two transactions | `CardRepository.Update(id, input, targetColumnId)` does both atomically; dead "restore" path removed |
| 9 | Low | New column hidden while a column filter was active | New column options are auto-selected when a column filter is active |
| 10 | Low | Deleting a column (moving cards) changed archived cards' archive date | Archived rows keep `UpdatedAt` |
| 11 | Low | Search was culture-sensitive (Turkish İ/ı) | Invariant-culture case-insensitive matching |
| 12 | Low | Due badges stale after midnight | Minute timer calls `CheckDateRollover`, which reloads the board when the date changes |

Also from the review: a keyboard-shortcuts dialog (F1, sidebar, board menu) makes Ctrl+N and the
Ctrl+arrow moves discoverable; weak UI tests (`WelcomeScreen_Renders`, `MinimumWindowSize_…`) now
assert on rendered controls and bounds; duplicated helpers removed.

## Work Log

### Session 1

- Installed .NET 10 SDK (10.0.112) from the Ubuntu feed (the default dotnet download host is blocked here).
- Built Core (domain + rules), Data (migrations, repositories), App (Avalonia shell, views, view models).
- Sub-agent wrote the Core/Data test suite in an isolated worktree; lead verified (288 passing) and
  merged it, then fixed the three edge cases it reported (see decisions).
- Lead wrote view-model and headless UI tests; ran the real app under Xvfb and drove it with `xdotool`.
- Independent Opus review → 12 findings, all fixed with regression tests; final clean validation.

## Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| Runtime | .NET 10 | Required by spec |
| UI | Avalonia 12.1.3 + Fluent theme, CommunityToolkit.Mvvm | Current Avalonia; MVVM source generators avoid boilerplate |
| Database | SQLite (Microsoft.Data.Sqlite) | Local-first storage |
| Persistence | Dapper repositories, SQL in `BoardFlow.Data` only | Required by spec |
| Schema | Ordered migrations, `PRAGMA user_version`, backup with `VACUUM INTO` before upgrade | Versioned evolution without data loss |
| Logging | Serilog file sink (daily, 14 days) bridged to `ILogger<T>`; Avalonia warnings forwarded | Required by spec |
| Testing | xUnit v3; Avalonia.Headless.XUnit for UI | Avalonia 12's headless package requires xUnit v3 |
| DI | Microsoft.Extensions.DependencyInjection, validated on build | Required by spec |
| Project structure | Core (no deps) / Data / App + two test projects | Testable rules separated from UI |
| Ordering | Dense integer sort orders rewritten per move in one transaction | Rapid moves can never create gaps/duplicates |
| Card descriptions | Plain text | Spec allows plain text; avoids a Markdown dependency |
| Drag and drop | Pointer events (not OS drag-drop API) | Same on every platform, headlessly testable |
| Dialogs/panels | In-window overlay layers | Consistent, testable, no window-ownership issues |
| Threading | Database calls synchronous on UI thread | Sub-millisecond local ops; removes concurrency bugs |
| Foreign/corrupt/newer DB | Refuse to start with an error window, never modify | Spec: never silently reset a valid database |

## Agent / Model Work Log

| Milestone | Role | Model | Task | Result / Verification |
|---|---|---|---|---|
| 1–10 | Lead | Opus | Architecture, all production code, view-model/UI tests, docs, integration | Builds and tests below |
| 6 | Implementation | Sonnet (worktree) | Core + Data xUnit suite (12 classes) | 288 passing; re-run by lead; no production edits; 3 edge cases reported and fixed by lead |
| 10 | Review | Opus (fresh context, read-only) | Independent review against SPEC | 12 findings (1 high); all verified by lead and fixed with regression tests |

## Verification History

| Date/Session | Milestone | Build | Tests | Manual/Other Verification | Result |
|---|---|---|---|---|---|
| S1 | 1 | `dotnet build` 0 warn / 0 err | Core/Data smoke test 1/1 | Dapper type-handler round trip | Pass |
| S1 | 6 | — | Core/Data 291/291 | Sub-agent suite re-run by lead + 3 new edge-case tests | Pass |
| S1 | 1–5 | `dotnet build` clean | App 15/15 | Real app under Xvfb: welcome screen, DB + log created; caught and fixed missing DI registration | Pass |
| S1 | 2–9 | clean | App 39/39 | Real X11 run with `xdotool`: create workspace/board, Ctrl+N quick-add ×2, drag card to Todo, restart process → card still in Todo | Pass |
| S1 | 10 (review fixes) | clean | Core/Data 299/299, App 49/49 | 5 new UI regression tests shown failing on pre-fix code | Pass |
| S1 | 10 (final) | clean restore + build, 0 warnings | 348/348; again 348/348 under `TZ=America/Los_Angeles` + `tr_TR` | Real X11 end-to-end re-run; DB inspected: ISO `…Z` timestamps, moved card in Todo after restart | Pass |

## Known Issues

No known defects. Limitations (by design, documented in README): single window/user, boards not
reorderable in the sidebar, plain-text descriptions, no undo, light theme only, search scoped to the
open board. Avalonia logs harmless platform warnings on headless Linux (no DBus/GLX) at start-up.

## Blockers

None.

## Stretch Goals

Not started (stretch-goal rule: only after Milestone 10 is verified).

-   [ ] JSON import/export
-   [ ] Board templates
-   [ ] Dark/light theme toggle
-   [ ] Activity history
-   [ ] Card checklists
-   [ ] Saved filters
-   [ ] Backup/restore
-   [ ] Additional keyboard-first workflows

## Final Handoff

### Completed milestones

-   1–10, each checked criterion by criterion above.

### Partial milestones

-   None.

### Blocked milestones

-   None.

### Build result

Clean restore and `dotnet build` of `BoardFlow.sln`: **0 warnings, 0 errors** (`TreatWarningsAsErrors`).

### Test result

`dotnet test`: **348 passed, 0 failed, 0 skipped** — `BoardFlow.Tests` 299, `BoardFlow.App.Tests` 49.
Same result under `TZ=America/Los_Angeles` with a Turkish locale.

### Known defects

None known.

### Important architectural decisions

See the decisions table above and README "Design decisions": Core/Data/App split, Dapper
repositories with one transaction per write, versioned migrations with backup and never-reset policy,
dense sort orders, reload-from-database UI, pointer-based drag and drop, in-window dialogs/panels.

### Meaningful model/sub-agent usage

-   Sonnet (isolated worktree): Core/Data test suite — 288 tests, verified and merged by the lead.
-   Opus (fresh context): independent read-only review — 12 findings, all fixed by the lead.
-   Lead (Opus): architecture, all production code, app tests, real-app verification, docs.

### Human-review areas

-   `src/BoardFlow.App/Views/BoardView.axaml.cs` — drag-and-drop hit testing; worth a manual try on
    Windows and macOS with real mice/trackpads (verified headless and on Linux X11 only).
-   Visual design (`Styles/Theme.axaml`) — reviewed via screenshots only, on Linux.
-   `src/BoardFlow.Data/DapperConfig.cs` — relies on `SqlMapper.RemoveTypeMap(DateTime)`; keep the
    `Timestamps_AreStoredAsIsoUtcText` test when upgrading Dapper.

### Recommended next 3 actions

1.  Run the app on Windows and macOS (`dotnet run --project src/BoardFlow.App`) and try drag and
    drop, dialogs and shortcuts with real input devices.
2.  Start stretch goals in spec order: JSON import/export, then board templates.
3.  Add CI (GitHub Actions: `dotnet build` + `dotnet test` on Windows/macOS/Linux; the UI tests are
    headless and need no display).
