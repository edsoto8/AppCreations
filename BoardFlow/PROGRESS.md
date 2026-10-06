# BoardFlow --- Progress Tracker

Last updated: Not started

## Status Legend

-   `[ ]` Not started
-   `[~]` In progress / partially complete
-   `[x]` Verified complete
-   `[!]` Blocked

## Required Milestones

-   [ ] Milestone 1 --- Foundation
-   [ ] Milestone 2 --- Workspaces and Boards
-   [ ] Milestone 3 --- Columns
-   [ ] Milestone 4 --- Cards
-   [ ] Milestone 5 --- Drag, Drop, and Ordering
-   [ ] Milestone 6 --- Persistence and Data Integrity
-   [ ] Milestone 7 --- Search and Filtering
-   [ ] Milestone 8 --- Productivity Features
-   [ ] Milestone 9 --- Polish and Resilience
-   [ ] Milestone 10 --- Final Validation and Handoff

## Current Milestone

**Milestone:** 1 --- Foundation\
**Status:** Not started

### Current objective

Initialize the .NET 10 solution and satisfy all Milestone 1 acceptance
criteria from `SPEC.md`.

### Acceptance Criteria

Copy the current milestone's acceptance criteria here while working and
check each item individually.

## Work Log

### Session 1

-   Not started.

## Architecture Decisions

  ------------------------------------------------------------------------------------------
  Decision                Choice                                     Reason
  ----------------------- ------------------------------------------ -----------------------
  Runtime                 .NET 10                                    Required by project
                                                                     specification

  UI                      Avalonia UI                                Cross-platform desktop
                                                                     UI

  Database                SQLite                                     Local-first storage

  Persistence             Dapper                                     Required by project
                                                                     specification

  Logging                 Serilog                                    Required by project
                                                                     specification

  Testing                 xUnit                                      Required by project
                                                                     specification

  Dependency injection    Microsoft.Extensions.DependencyInjection   Standard .NET DI

  Project structure       TBD                                        Decide during Milestone
                                                                     1
  ------------------------------------------------------------------------------------------

## Agent / Model Work Log

Record meaningful delegated work. Do not record trivial calls.

  Milestone   Role   Model            Task                  Result / Verification
  ----------- ------ ---------------- --------------------- -----------------------
  ---         Lead   Opus preferred   Project not started   ---

## Verification History

Record only commands/checks actually performed.

  -----------------------------------------------------------------------------
  Date/Session   Milestone   Build       Tests       Manual/Other   Result
                                                     Verification   
  -------------- ----------- ----------- ----------- -------------- -----------
  ---            ---         ---         ---         ---            ---

  -----------------------------------------------------------------------------

## Known Issues

None recorded yet.

## Blockers

None recorded yet.

## Stretch Goals

Do not begin until all required milestones satisfy the stretch-goal rule
in `CLAUDE.md`.

-   [ ] JSON import/export
-   [ ] Board templates
-   [ ] Dark/light theme toggle
-   [ ] Activity history
-   [ ] Card checklists
-   [ ] Saved filters
-   [ ] Backup/restore
-   [ ] Additional keyboard-first workflows

## Final Handoff

Complete this section when stopping because the project is finished,
blocked, or the session/resource limit has been reached.

### Completed milestones

-   None yet.

### Partial milestones

-   None yet.

### Blocked milestones

-   None.

### Build result

Not run.

### Test result

Not run.

### Known defects

None recorded.

### Important architectural decisions

-   .NET 10
-   Avalonia UI
-   SQLite + Dapper
-   Serilog
-   xUnit
-   Microsoft dependency injection

### Meaningful model/sub-agent usage

None yet.

### Human-review areas

To be determined.

### Recommended next 3 actions

1.  Begin Milestone 1.
2.  Establish a clean build and test baseline.
3.  Continue through milestones in order.
