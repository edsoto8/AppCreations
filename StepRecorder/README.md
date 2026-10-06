# Step Recorder

A lightweight Windows step recorder that lives in the system tray. It records what you click, captures
just the window you clicked in, and turns the session into a readable report. It's meant to replace
Windows Steps Recorder for bug reports, QA evidence and how-to guides. Everything stays on your machine.

The full product spec is [`../StepRecorder-MultiModel-Spec.md`](../StepRecorder-MultiModel-Spec.md).

## Status

| Milestone | State |
|---|---|
| Phase 0 — technical spike / architecture decisions | Done (see `docs/decisions/`) |
| 1 — Application shell (tray, start/pause/stop, sessions, settings) | **Built; Windows manual checks pending** |
| 2 — Global click recording | **Built; Windows manual checks pending** |
| 3 — Window screenshots | **Built; Windows manual checks pending** |
| 4 — HTML + Markdown reports with click markers | **Built; Windows manual checks pending** |
| Phase 5 — click markers in image copies, double-click merging, screenshot format | **Built; Windows manual checks pending** |
| Phase 6 — UI Automation: name the clicked control | **Built; Windows manual checks pending** |
| 7+ — reliability/recovery, privacy, editor, smart processing, exports, AI | Not started |

Each left or right click in another application becomes a step in `session.json`, with the window, app
and click position, the control that was clicked (via UI Automation, e.g. "Click the **Save** button in
**Invoice Editor**"), plus a PNG of just that window. When you stop, Step Recorder writes `report.html`
(click markers drawn over each screenshot) and `report.md`, and offers to open the report.

## Requirements

- Windows 10 or 11 to run
- .NET 10 SDK to build (the solution builds on macOS/Linux too, but the app only runs on Windows)

## Build, test and run

Run these from this `StepRecorder/` folder:

```bash
dotnet build                                              # whole solution; warnings are errors
dotnet test                                               # all tests (any OS)
dotnet test --filter "FullyQualifiedName~RecorderTests"   # one test class
dotnet run --project src/StepRecorder.App                 # Windows only
dotnet format                                             # before committing
```

## Using it

Step Recorder starts in the notification area of the taskbar (you may need to open the `^` overflow).
It never opens a main window. Right-click the icon for the menu:

| Command | What it does |
|---|---|
| Start Recording | Creates a new session folder and starts recording clicks |
| Pause / Resume Recording | Pauses without ending the session |
| Stop Recording | Finalizes the session and writes its reports; click the notification to open the report |
| Open Last Recording | Opens the most recent report (writing it first for an interrupted session) |
| Settings… | Recordings folder and name; which clicks to record, double-click merging, control identification; PNG/JPEG and quality; click markers and their size; report formats |
| Exit | Asks first if a recording is in progress, then stops and saves it |

The icon shows the state: **grey** dot = not recording, **red** dot = recording, **amber** pause symbol = paused.
The top line of the menu and the tooltip say the same thing, with the number of steps so far.

Clicks on Step Recorder's own windows and menu are never recorded. Nothing is observed while paused.

Only one copy of the app runs at a time, and only one recording at a time. If Windows logs off or shuts
down mid-recording, the session is stopped and saved automatically.

## Where things are stored

| What | Where |
|---|---|
| Recordings | `Documents\StepRecorder\Sessions\` by default (change in Settings) |
| Settings | `%LOCALAPPDATA%\StepRecorder\settings.json` |
| Logs | `%LOCALAPPDATA%\StepRecorder\logs\steprecorder-YYYYMMDD.log` (kept 14 days) |

Each recording is a self-contained folder that can be moved or zipped:

```text
2026-10-05_175700_Recording/
  report.html       readable report; open in any browser, works offline
  report.md         same report in Markdown (for wikis, tickets, pull requests)
  assets/           report.css, report.js
  session.json      metadata and steps; saved after every step, with no absolute paths
  screenshots/
    step-001.png    the clicked window only, named by step number (.jpg if JPEG is chosen)
    marked/         copies with the click marker drawn in (used by report.md); originals stay untouched
```

`session.json` holds a `status` field. A session still marked `Recording` or `Paused` after the app has
closed was interrupted, for example by a crash. Recovering those sessions is planned for Phase 7.

## Project structure

```text
StepRecorder/
├── src/
│   ├── StepRecorder.Core/     Platform-neutral: session/step model, Recorder state machine,
│   │                          ClickRecorder pipeline, settings, file storage, reports
│   │                          (HTML/Markdown exporters). No Windows APIs.
│   ├── StepRecorder.Windows/  Win32 (net10.0-windows): low-level mouse hook, window lookup,
│   │                          window capture, marker drawing, UI Automation
│   └── StepRecorder.App/      WPF tray app (net10.0-windows): TrayController, SettingsWindow,
│                              tray icons, file logger
├── tests/StepRecorder.Tests/  xUnit tests for Core
└── docs/
    ├── decisions/             Architecture decision records
    ├── manual-tests.md        Windows checks per milestone
    └── windows-limitations.md Known/suspected Windows API limits
```

## Privacy

Recording is local only, with no network access. The recorder does not log keystrokes, and its mouse
hook is installed only while recording. UI Automation reads only control names and types, never field
contents. Password fields are flagged in the report, and their contents are never read. Logs never
contain typed text, passwords or image data. It runs without administrator rights and does not try to
capture protected windows or secure desktops.
