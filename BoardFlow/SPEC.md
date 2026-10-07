# BoardFlow --- Product Specification

## 1. Purpose

Build **BoardFlow**, a local-first Trello-style desktop project manager
that demonstrates how far an autonomous coding agent can take a
greenfield .NET application.

The application must be useful as a real lightweight personal project
manager, not merely a UI demo.

## 2. Required Technology Stack

-   **.NET 10**
-   **C#**
-   **Avalonia UI** for the cross-platform desktop interface
-   **SQLite** for local data storage
-   **Dapper** for database access and persistence
-   **Serilog** for structured application logging
-   **xUnit** for automated testing
-   **Microsoft.Extensions.DependencyInjection** for dependency
    injection
-   Local-only application
-   No web backend
-   No user accounts
-   No cloud synchronization
-   No paid third-party services required

Do **not** introduce Entity Framework Core. Prefer maintainable,
conventional .NET architecture over unnecessary abstraction.

## 3. Core Domain

### Workspace

-   Id
-   Name
-   CreatedAt
-   UpdatedAt

### Board

-   Id
-   WorkspaceId
-   Name
-   Description
-   CreatedAt
-   UpdatedAt
-   SortOrder

### Column

-   Id
-   BoardId
-   Name
-   SortOrder
-   CreatedAt
-   UpdatedAt

### Card

-   Id
-   ColumnId
-   Title
-   Description
-   Priority
-   DueDate
-   IsArchived
-   SortOrder
-   CreatedAt
-   UpdatedAt

### Label

-   Id
-   WorkspaceId
-   Name
-   DisplayColor

Cards may have zero or more labels.

## 4. Required Milestones

### Milestone 1 --- Foundation

Implement: - .NET 10 solution and project structure - Avalonia
application shell - SQLite persistence layer using Dapper - Database
creation and versioned schema initialization/migrations - Dependency
injection - Serilog structured logging - xUnit test project - Basic
navigation/layout - README with build/run/test instructions

Acceptance criteria: - Entire solution builds without errors. -
Application launches successfully. - SQLite database is created
automatically. - Dapper is used for application persistence; EF Core is
not introduced. - Serilog is configured and startup/application errors
are logged. - Automated test project runs successfully. - README
contains working commands for build, test, and run.

### Milestone 2 --- Workspaces and Boards

Implement: - Create workspace - Rename workspace - Delete workspace with
confirmation - Create board - Rename/edit board - Delete board with
confirmation - Switch between boards - Persist all workspace and board
data

Acceptance criteria: - User can create a workspace and at least two
boards. - Switching boards shows the correct board. - Restarting the
application preserves workspaces and boards. - Destructive operations
require confirmation. - Relevant business logic has automated tests.

### Milestone 3 --- Columns

Implement: - Create column - Rename column - Delete column - Reorder
columns - Default board columns may be offered: Backlog, Todo, In
Progress, Review, Done - Persist ordering

Acceptance criteria: - Multiple columns can exist on a board. - Columns
can be reordered. - Column order survives application restart. -
Deleting a non-empty column must not silently destroy cards; require
explicit confirmation or safe movement behavior. - Column behavior is
covered by appropriate tests.

### Milestone 4 --- Cards

Implement: - Create card - Edit card - Delete card with confirmation -
Title - Markdown-capable or plain-text description - Priority: None,
Low, Medium, High, Critical - Optional due date - Labels -
Archive/unarchive - Persist all card fields

Acceptance criteria: - Given an existing board and column, a user can
create a card and edit every supported field. - A saved card displays
the same values after application restart. - Archived cards are hidden
from the normal board view and can be restored. - Validation prevents
invalid required data. - Card CRUD and persistence have automated tests.

### Milestone 5 --- Drag, Drop, and Ordering

Implement: - Drag cards between columns - Reorder cards within a
column - Persist destination and ordering - Reorder columns using
drag-and-drop if practical; otherwise retain a clear alternate reorder
interaction

Acceptance criteria: - A card can move from one column to another. -
Multiple cards can be reordered predictably. - New positions survive
restart. - Rapid moves do not duplicate or lose cards. - Ordering logic
is tested independently from the UI where practical.

### Milestone 6 --- Persistence and Data Integrity

Harden: - SQLite initialization - Versioned schema evolution - Dapper
repositories/data access - Transactions where appropriate - Referential
integrity - Graceful database errors - Serilog diagnostics around
persistence failures - No duplicate records caused by normal UI
operations

Acceptance criteria: - Closing and reopening the app preserves all
normal user data. - Workspace → board → column → card relationships
remain valid. - Failed writes produce a useful error and are logged
through Serilog. - Automated tests cover important persistence paths. -
Application does not silently reset or replace an existing valid
database.

### Milestone 7 --- Search and Filtering

Implement: - Search cards by title and description - Filter by
priority - Filter by label - Filter by column/status - Filter by
due-date state, including overdue - Clear filters - Combine sensible
filters

Acceptance criteria: - Search returns relevant cards from the active
scope. - Filters update results correctly. - Clearing filters restores
the complete normal view. - Search/filter logic is tested.

### Milestone 8 --- Productivity Features

Implement: - Quick-add card - Duplicate card - Keyboard shortcuts for
common actions - Archive browser and restore - Useful empty states -
Card detail dialog/panel - Markdown rendering if Markdown descriptions
were selected

Suggested shortcuts: - Ctrl/Cmd+N: quick-add card - Ctrl/Cmd+F: focus
search - Escape: close active modal/panel

Acceptance criteria: - Quick-add requires minimal interaction. -
Duplicate creates a distinct persisted card. - Archive browser can
restore archived cards. - Implemented shortcuts are documented and work
consistently.

### Milestone 9 --- Polish and Resilience

Improve: - Visual hierarchy and spacing - Consistent typography - Empty
states - Confirmation dialogs - Validation messages - Error handling -
Loading/busy states where meaningful - Window resizing - Reasonable
minimum window size - Keyboard navigation where practical -
Accessibility labels/names where supported - Serilog coverage for
meaningful failures and lifecycle events - Resource cleanup

Acceptance criteria: - Normal workflows do not produce unhandled
exceptions. - UI remains usable at common desktop window sizes. - Errors
are understandable to the user and detailed enough in Serilog logs for
diagnosis. - Empty boards and workspaces look intentional rather than
broken. - The interface has consistent styling rather than default
controls placed without design consideration.

### Milestone 10 --- Final Validation and Handoff

Perform: - Clean restore - Clean build - Full automated test suite - Fix
all reproducible failures within scope - Review every acceptance
criterion in this specification - Review warnings and obvious dead
code - Update README - Update PROGRESS.md - Complete SCORECARD.md -
Document known limitations and recommended next steps

Acceptance criteria: - Clean build succeeds. - Full test suite passes,
or any unavoidable failure is explicitly documented with evidence. -
README accurately describes the actual implementation. - PROGRESS.md
reflects reality. - No milestone may be marked complete solely because
code exists; acceptance criteria must be checked.

## 5. UX Expectations

The visual design should be clean and desktop-oriented.

Required layout concepts: - Workspace/board navigation - Board title and
actions - Horizontally arranged columns - Cards visually grouped within
columns - Clear drag/drop affordances - Search/filter access without
dominating the screen - Card editor/detail surface

Do not reproduce Trello branding. BoardFlow should have its own simple
visual identity.

## 6. Testing Strategy

Prioritize automated tests for: - Domain/business rules - CRUD
services - Dapper persistence - Ordering - Moving cards - Search/filter
logic - Archive/restore - Validation

UI automation is optional for the first autonomous run unless a reliable
framework can be introduced without destabilizing the project.

Never create tests that merely assert mocked behavior with no meaningful
application logic.

## 7. Non-Goals for MVP

Do not implement unless all required milestones are complete: -
Authentication - Cloud sync - Multi-user collaboration - Real-time
updates - Email - Push notifications - Mobile apps - Web application -
File attachments - External integrations - AI features

## 8. Stretch Goals

Only begin after all required milestones pass: 1. Import/export board
data as JSON 2. Board templates 3. Dark/light theme toggle 4. Activity
history 5. Card checklists 6. Saved filters 7. Backup/restore 8.
Additional keyboard-first workflows

## 9. Definition of Done

The MVP is done only when: - All ten milestones satisfy their acceptance
criteria. - The solution clean-builds. - Automated tests pass. - Core
workflows survive restart. - No known data-loss bug remains. - Dapper
remains the persistence technology. - Serilog is used for application
logging. - README is accurate. - PROGRESS.md is current. - SCORECARD.md
has been honestly completed.
