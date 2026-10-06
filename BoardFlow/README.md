# BoardFlow

BoardFlow is a local-first, Trello-style project board for the desktop. Organise work into
**workspaces → boards → columns → cards**, drag cards between columns, and find things quickly with
search and filters. Everything is stored in a local SQLite file; there are no accounts, no cloud and no
network access.

Built with .NET 10, Avalonia 12 (cross-platform UI), SQLite + Dapper, Serilog,
Microsoft.Extensions.DependencyInjection and xUnit v3. `SPEC.md` is the product specification and
`PROGRESS.md` records what has been built and verified.

## Requirements

- .NET 10 SDK (`dotnet --list-sdks` should show `10.0.x`)
- Windows, macOS or Linux with a desktop session (X11 on Linux)

## Commands

Run every command from this `BoardFlow/` folder.

```bash
dotnet restore                                   # restore NuGet packages
dotnet build                                     # whole solution (warnings are errors)
dotnet test                                      # all tests: Core/Data + view models + headless UI
dotnet test tests/BoardFlow.Tests                # Core and Data tests only
dotnet test tests/BoardFlow.App.Tests            # view-model and headless UI tests only
dotnet run --project src/BoardFlow.App           # start the app
dotnet run --project src/BoardFlow.App -- --data-dir ./sample-data   # use a different data folder
```

Set `BOARDFLOW_SCREENSHOTS=<folder>` when running `BoardFlow.App.Tests` to save PNG screenshots of
the headless UI tests, which is handy for reviewing visual changes.

## Where data lives

| What | Default location |
|---|---|
| Database | `boardflow.db` in the per-user local data folder: Windows `%LOCALAPPDATA%\BoardFlow`, macOS `~/Library/Application Support/BoardFlow`, Linux `~/.local/share/BoardFlow` |
| Logs | `<data folder>/logs/boardflow-YYYYMMDD.log` (daily files, 14 kept) |
| Upgrade backups | `<data folder>/boardflow.db.v<N>-<timestamp>.bak`, written before any schema upgrade |

Override the data folder with `--data-dir <folder>` or the `BOARDFLOW_DATA_DIR` environment variable.
Add `--verbose` for debug-level logging.

BoardFlow never deletes or recreates an existing database. If the file is corrupt, is not a BoardFlow
database, or was created by a newer version, the app shows an error window, logs the reason and leaves
the file untouched.

## Using BoardFlow

- **Workspaces** (sidebar picker, `…` menu): create, rename, delete. Labels belong to a workspace and
  are shared by its boards.
- **Boards** (sidebar list): create (optionally with the default columns Backlog, Todo, In Progress,
  Review, Done), edit name and description, delete. The last open board is reopened on start.
- **Columns**: add, rename, reorder (drag the column header, or use *Move left/right* in the column's
  `…` menu), delete. Deleting a column that holds cards asks whether to move them to another column
  (the default) or delete them; cards are never removed silently.
- **Cards**: click a card to open its detail panel and edit the title, plain-text description,
  priority (None, Low, Medium, High, Critical), optional due date, labels and column. From the panel
  you can also archive, duplicate or delete the card.
- **Drag and drop**: drag a card onto another column or between cards; a teal bar shows where it will
  land. Order is saved immediately.
- **Archive**: archived cards disappear from the board. *Archive* in the board header lists them and
  restores them (to the bottom of their column) or deletes them permanently.
- **Search and filter**: the search box matches every word against card titles and descriptions.
  *Filter* narrows by priority, label, column and due date (overdue, due today, due in the next
  7 days, has/no due date). Options within a group are combined with OR, groups with AND.
  *Clear filters* restores the full board.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` (`Cmd+N`) | Quick-add a card to the first visible column |
| `Enter` in a quick-add box | Add the card and keep the box open for the next one |
| `Ctrl+F` (`Cmd+F`) | Focus the search box |
| `Escape` | Cancel the dialog, close the side panel, close quick-add, or clear the focused search |
| `Enter` in a dialog | Confirm the dialog |
| `Ctrl+Enter` in the card panel | Save the card |
| `Ctrl+↑` / `Ctrl+↓` on a focused card | Move the card up / down in its column |
| `Ctrl+←` / `Ctrl+→` on a focused card | Move the card to the previous / next column |
| `Tab` / `Shift+Tab`, then `Enter` | Move between controls and cards; open the focused card |

## Project structure

```
BoardFlow/
├── src/BoardFlow.Core/        Domain model and pure rules: validation, ordering, due dates, search/filter
├── src/BoardFlow.Data/        SQLite via Dapper: connection, versioned migrations, repositories
├── src/BoardFlow.App/         Avalonia app: start-up, DI, Serilog, view models, views, theme
├── tests/BoardFlow.Tests/     xUnit tests for Core and Data (real SQLite files in temp folders)
└── tests/BoardFlow.App.Tests/ View-model workflows and headless UI tests of the real window
```

Dependency rule: `Core` depends on nothing; `Data` depends on `Core`; `App` depends on both.

## Design decisions

- **Dapper, not EF Core.** SQL lives in the repositories. Dapper type handlers store timestamps as
  ISO-8601 UTC text and due dates as `yyyy-MM-dd`.
- **Versioned schema.** Migrations are an ordered list; the applied version is stored in
  `PRAGMA user_version`. Each migration runs in a transaction, and an existing database is backed up
  with `VACUUM INTO` before it is upgraded.
- **Every write is one transaction**, and foreign keys are enforced (`ON DELETE CASCADE` from
  workspace to board to column to card, and from labels to card links).
- **Dense sort orders.** Active cards in a column are always numbered 0..n-1, as are columns on a
  board. A move rewrites the affected lists from the current database state in one transaction, so
  repeated or rapid moves cannot duplicate or lose cards. Archived cards leave the sequence and
  rejoin at the bottom on restore.
- **The UI reloads from the database after each change**, reusing view-model instances by id so
  focus and scroll position survive. What you see is what is stored.
- **Database work runs synchronously on the UI thread.** Local SQLite operations take well under a
  millisecond at this scale, and serialising them removes a whole class of concurrency bugs. There are
  therefore no loading spinners.
- **Plain-text descriptions.** The spec allowed Markdown or plain text; plain text was chosen to avoid
  a rendering dependency. Line breaks are preserved.
- **Drag and drop uses pointer events** (press, move past a small threshold, release) rather than the
  OS drag-and-drop API, so it behaves the same on every platform and can be tested headlessly.
- **Dialogs and panels are drawn inside the main window** (overlay layers), not as separate OS
  windows, which keeps them consistent across platforms and testable.
- **Errors**: validation problems are shown inline or as a red toast; database failures are logged by
  the repository with the operation name and SQLite error and shown to the user as
  "Could not … Your previous data is unchanged." Unexpected exceptions on the UI thread are logged
  and reported without closing the app.

## Known limitations

- Single window, single user. Running two copies on the same data folder is not supported.
- Boards cannot be reordered in the sidebar (they are listed in creation order).
- Card descriptions are plain text (no Markdown rendering).
- Search and filtering apply to the open board only.
- There is no undo; destructive actions ask for confirmation instead.
- Light theme only.
