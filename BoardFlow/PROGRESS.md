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
-   [~] Milestone 10 --- Final Validation and Handoff

## Current Milestone

**Milestone:** 10 --- Final Validation and Handoff\
**Status:** In progress (independent review running; final clean build/test pending)

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
- Accessibility names on icon buttons, cards (summarised), inputs; keyboard navigation and card moves.
- Busy indicators: not added — every operation is a sub-millisecond local SQLite call (decision below).

## Work Log

### Session 1

- Installed .NET 10 SDK (10.0.112) from the Ubuntu feed (the default dotnet download host is blocked here).
- Built Core (domain + rules), Data (migrations, repositories), App (Avalonia shell, views, view models).
- Sub-agent wrote the Core/Data test suite in an isolated worktree; lead verified (288 passing) and
  merged it, then fixed the three edge cases it reported (see decisions).
- Lead wrote view-model and headless UI tests; ran the real app under Xvfb and drove it with `xdotool`.

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
| 10 | Review | Opus (fresh context) | Independent review against SPEC | See review section |

## Verification History

| Date/Session | Milestone | Build | Tests | Manual/Other Verification | Result |
|---|---|---|---|---|---|
| S1 | 1 | `dotnet build` 0 warn / 0 err | Core/Data smoke test 1/1 | Dapper type-handler round trip | Pass |
| S1 | 6 | — | Core/Data 291/291 | Sub-agent suite re-run by lead + 3 new edge-case tests | Pass |
| S1 | 1–5 | `dotnet build` clean | App 15/15 | Real app under Xvfb: welcome screen, DB + log created; caught and fixed missing DI registration | Pass |
| S1 | 2–9 | clean | App 39/39 | Real X11 run with `xdotool`: create workspace/board, Ctrl+N quick-add ×2, drag card to Todo, restart process → card still in Todo | Pass |

## Known Issues

None open (see review section for anything found in final review).

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

To be completed at the end of Milestone 10.
