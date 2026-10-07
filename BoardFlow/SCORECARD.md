# BoardFlow --- 100-Point Evaluation Scorecard

Use this after the autonomous build. Award points only for behavior or
quality supported by inspection, tests, build output, or direct use.

> **Scored by the lead build agent at handoff (self-assessment).** Every score cites evidence that
> can be re-checked in the repository (test names refer to `tests/`). An independent human evaluation
> should replace these numbers; where unsure, points were withheld rather than given.

## 1. Core Functionality --- 35 points

  Criterion                                            Max   Score
  ----------------------------------------------- -------- -------
  Workspaces and boards CRUD + persistence               6       6
  Columns CRUD + ordering + persistence                  6       6
  Cards CRUD with required fields + persistence          8       8
  Card movement and ordering                             6       5
  Archive/restore and duplicate                          4       4
  Search and filtering                                   5       5
  **Subtotal**                                      **35**  **34**

Evidence: `WorkspaceAndBoardTests`, `ColumnWorkflowTests`, `CardWorkflowTests` (every field survives
restart), `FilterAndLabelTests`, `BoardInteractionTests` (real-window drags), repository suites.
One point withheld on movement: drag and drop was verified headlessly and on Linux X11 only, not with
Windows/macOS input devices.

## 2. Reliability and Data Integrity --- 15 points

  Criterion                                                 Max   Score
  ---------------------------------------------------- -------- -------
  Restart preserves expected data and ordering                5       5
  No observed normal-workflow data loss/duplication           4       4
  Validation and destructive-action safeguards                3       3
  Graceful error handling and useful Serilog logging          3       3
  **Subtotal**                                           **15**  **15**

Evidence: restart tests at repository and app level; 500-move stress test against an independent
model; corrupt/foreign/newer database left byte-identical; failed-write test checks the user message
and the log. The review's one data-loss bug (Enter on a focused Cancel) is fixed and covered by
`ReviewRegressionUiTests`.

## 3. Automated Testing --- 15 points

  Criterion                                              Max   Score
  ------------------------------------------------- -------- -------
  Meaningful domain/business-rule tests                    4       4
  Dapper persistence/service tests                         4       4
  Ordering/movement/search/filter tests                    4       4
  Full suite passes and tests are not superficial          3       3
  **Subtotal**                                        **15**  **15**

Evidence: 348/348 passing (299 Core/Data, 49 App), also under a non-UTC time zone and Turkish
locale. Tests use real SQLite files and the real window; no mocks of our own code. Regression tests
were shown to fail against the pre-fix code.

## 4. Code and Architecture Quality --- 15 points

  Criterion                                                           Max   Score
  -------------------------------------------------------------- -------- -------
  Clear separation of concerns                                          4       4
  Readable, idiomatic C#/.NET 10                                        3       3
  Appropriate dependency use; no needless complexity                    3       3
  Maintainable domain/Dapper/UI boundaries                              3       2
  No obvious dead code, dangerous shortcuts, or secret leakage          2       2
  **Subtotal**                                                     **15**  **14**

Core has no dependencies; SQL lives only in Data; every write is one transaction; build is
warning-free with warnings as errors. One point withheld: view models call repositories directly
(no service layer), and `BoardView.axaml.cs` drag-and-drop hit testing is the most intricate code and
is only tested through UI tests.

## 5. User Experience and Visual Polish --- 10 points

  Criterion                                                       Max   Score
  ---------------------------------------------------------- -------- -------
  Clear information hierarchy and usable board layout               3       3
  Consistent spacing, typography, controls, and dialogs             2       2
  Useful empty/error/validation states                              2       2
  Window resizing and common desktop sizes work reasonably          2       1
  Keyboard/productivity interactions are usable                     1       1
  **Subtotal**                                                 **10**   **9**

Evidence: screenshots reviewed (welcome, board, editor, quick add, minimum size, shortcuts). One
point withheld: sizes were checked at 960×600 to 1900 wide on Linux only, and high-DPI scaling was not
tested.

## 6. Documentation and Handoff --- 10 points

  Criterion                                                 Max   Score
  ---------------------------------------------------- -------- -------
  README build/run/test instructions are accurate             3       3
  PROGRESS.md truthfully reflects implementation              3       3
  Architectural decisions and limitations documented          2       2
  Final handoff provides actionable next steps                2       2
  **Subtotal**                                           **10**  **10**

# Total

**Score: 97 / 100** (self-assessed; see note at top)

No automatic caps apply: the app builds and launches, data persists across restart, there is no
known data-loss bug, milestones are backed by evidence, and Dapper (not EF Core) is used.

## Suggested Interpretation

-   **90--100:** Strong autonomous build; close to a credible polished
    MVP.
-   **80--89:** Good result; useful application with limited cleanup
    needed.
-   **70--79:** Functional but meaningful gaps or quality issues remain.
-   **50--69:** Partial MVP; substantial human follow-up required.
-   **Below 50:** The autonomous run did not produce a dependable MVP.

## Automatic Caps

Apply these caps regardless of raw points: - Application does not build:
maximum **49/100** - Application cannot launch: maximum **49/100** -
Core data does not persist across restart: maximum **59/100** - Known
reproducible data-loss bug in normal use: maximum **59/100** - Major
milestones are claimed complete without evidence: maximum **69/100** -
EF Core replaces the required Dapper persistence approach without
explicit approval: maximum **69/100**

## Evaluator Notes

### Strongest areas

-   Data safety: transactional writes, enforced foreign keys, versioned migrations with backup, and a
    never-reset policy for corrupt, foreign or newer databases (all tested byte-for-byte).
-   Test depth: real SQLite and real-window UI tests, including simulated drag and drop, keyboard
    handling, restart persistence and time-zone/culture runs.

### Weakest areas

-   Verified on Linux only (headless and X11); Windows/macOS behaviour is untested.
-   No undo; no cross-board search; boards cannot be reordered.

### Reproducible defects

-   None known at handoff.

### What the lead agent completed

-   Architecture, all production code (Core, Data, App), view-model and UI tests, real-app runs,
    fixes for all 12 review findings, README/PROGRESS/SCORECARD.

### What sub-agents completed

-   Sonnet: Core/Data test suite (288 tests) in an isolated worktree, with no production changes.
-   Opus: independent read-only review (12 findings, 1 high severity).

### What required human intervention

-   None during the build.

### Next three improvements

1.  Manual pass on Windows and macOS, especially drag and drop and high-DPI layout.
2.  Stretch goal 1: JSON import/export of a board (also gives users a portable backup).
3.  CI matrix (Windows/macOS/Linux) running `dotnet build` and `dotnet test`.
