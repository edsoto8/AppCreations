# TaskFlow — Specification

TaskFlow is a single-user, offline task list. Version 1 deliberately has **no** accounts, sync, database or
network access.

## Platforms

| Target | TFM | Status |
|---|---|---|
| macOS desktop (primary) | `net10.0-desktop` | Builds; same build verified running on Linux X11. Not run on a Mac here. |
| Windows desktop | `net10.0-desktop` | Same build; not run on Windows here. |
| Linux desktop | `net10.0-desktop` | Built, run and exercised end to end (Xvfb + openbox). |
| WebAssembly (optional) | `net10.0-browserwasm` | Builds; see PROGRESS.md for run status. |
| Android / iOS (future) | — | Not configured. All logic is in `TaskFlow.Core`, so adding heads needs no rewrite. |

## Data model

| Field | Type | Rules |
|---|---|---|
| Id | Guid | Assigned on creation, never changes |
| Title | string | Required after trimming; at most 100 characters |
| Description | string | Optional; at most 1000 characters; trimmed |
| DueDate | DateOnly? | Optional; past dates allowed (the task shows as overdue) |
| Priority | Low / Medium / High | Default Medium |
| IsCompleted | bool | Default false |
| CreatedAt | DateTimeOffset | Set on creation; final sort tie-breaker |

## Features and acceptance criteria

### F1 Task list
- Shows every task matching the current filter as a card: check box, title, description (max 2 lines),
  priority badge, due date.
- Header shows "X of Y completed" (or "No tasks yet") and a completion progress bar.
- Completed tasks show struck through and dimmed.
- A task whose due date is before today and that is not completed shows "Overdue · <date>" in red.
  Due dates show as "Due today", "Due tomorrow", "Due yesterday" or "Due Mar 15" (year added when different).

### F2 Create
- "Add task" (or Ctrl+N) opens the editor titled "New task" with Medium priority and no due date.
- Saving a valid form adds the task, saves it to disk and returns to the list.

### F3 Edit
- The edit button on a card opens the editor titled "Edit task" with all fields pre-filled.
- Save applies the changes; Cancel, Back or Esc discards them.
- If the task was deleted meanwhile, the editor says so and cannot save.

### F4 Validation
- Saving with a blank title shows "Give the task a title." under the title box and stays on the page.
- After the first save attempt, messages update live while typing.
- The title box stops at 100 characters and the description at 1000; the same limits are enforced in
  `TaskValidator` and in `TaskService`, so invalid data can never be stored.

### F5 Complete / reopen
- Clicking the check box toggles completion and saves immediately.

### F6 Delete
- The delete button asks "Delete task?" naming the task. **Cancel is the default button** (Enter cancels).
  Only "Delete" removes the task.

### F7 Filter and sort
- Filter: All / Active (not completed) / Completed.
- Sort by due date: open tasks first; earliest due date first; tasks without a date last; ties by priority (high
  first), then creation time.
- Sort by priority: open tasks first; High → Low; ties by due date (no date last), then creation time.
- When nothing matches: "No tasks yet / Add your first task to get started." with no tasks at all, otherwise
  "No <filter> tasks / Try a different filter…".

### F8 Persistence
- Every change is written to `tasks.json` immediately (temporary file + atomic replace).
- On startup tasks are loaded; a progress ring shows while loading.
- Missing file → empty list, no message.
- Unreadable file (invalid JSON, missing required fields, unknown priority names) → the file is renamed to
  `tasks.corrupt-<timestamp>.json`, the app starts empty and shows a warning naming the backup.
- Repairable problems (null entries, duplicate ids, blank titles, unknown numeric priority) are fixed silently.
- File cannot be read at all (permissions) → error message, and **saving is disabled for the session** so the
  file is never overwritten.
- A failed save shows an error; the change stays visible in the app and is retried by the next save.

### F9 Appearance and accessibility
- Theme button cycles System → Light → Dark; the choice is remembered.
- At window widths under 720px the layout stacks (sort below filter; Add button shows only its icon; editor fields
  stacked).
- Every icon-only button has an accessible name that includes the task title ("Edit Buy milk") and a tooltip.
- Keyboard: Ctrl+N, Ctrl+S, Esc; the title box is focused when the editor opens.

## Out of scope for version 1
Authentication, cloud sync, databases, external APIs, notifications, recurring tasks, tags, search, undo.
