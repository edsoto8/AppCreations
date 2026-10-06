# 0005 — Project structure and session persistence

- Status: Accepted (Phase 0 / Milestone 1)
- Date: 2026-10-05

## Project structure

The spec (§19) lists eight modules but also says to avoid splitting into too many projects early. We
start with three and split only when a module grows big enough to deserve it:

| Project | TFM | Holds |
|---|---|---|
| `StepRecorder.Core` | `net10.0` | Session/step model, recording state machine, settings model, file storage, (later) reporting and coordinate maths. No Windows APIs. |
| `StepRecorder.App` | `net10.0-windows` | WPF tray app, settings window, (later) viewer. |
| `StepRecorder.Tests` | `net10.0` | xUnit tests for Core. Runs on any OS. |

Milestone 2 adds **`StepRecorder.Windows`** (`net10.0-windows`) for hooks, window discovery, capture and
UI Automation. Core talks to it only through interfaces (spec rule "keep Windows-specific code behind
explicit interfaces").

## Persistence

- Each session is a self-contained folder: `<RecordingsDirectory>/<yyyy-MM-dd_HHmmss>_<Name>/`.
  Name clashes get `-2`, `-3`, … added.
- `session.json` is rewritten **atomically** (write `session.json.tmp`, then rename over the old file)
  on every state change and, from Milestone 2 on, after every step. A crash therefore leaves the last
  good version, never a half-written file.
- `session.json` stores **no absolute paths**. The session directory is known at runtime from where the
  file was loaded, and screenshot paths are relative. A session folder can be moved or zipped.
- `Status` (`Recording`, `Paused`, `Completed`) is saved. A session left in `Recording`/`Paused` after a
  crash can therefore be found and recovered later (Phase 7).
- Settings live in `%LOCALAPPDATA%\StepRecorder\settings.json`, logs in `%LOCALAPPDATA%\StepRecorder\logs\`.
  A corrupt settings file is renamed to `settings.json.bak` and defaults are used.
- Dates are `DateTimeOffset` with the local offset, so reports can show local time with no guessing.
