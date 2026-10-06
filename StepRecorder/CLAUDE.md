# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Step Recorder is a Windows system-tray step recorder (WPF, .NET 10). The product spec is
`../StepRecorder-MultiModel-Spec.md` and is authoritative. `README.md` has the milestone status, usage
and storage locations. Architecture decisions are in `docs/decisions/`; read them before changing hooks,
capture, DPI handling or persistence.

## Commands

Run from this `StepRecorder/` folder:

```bash
dotnet build                                              # whole solution (warnings are errors)
dotnet test                                               # all tests
dotnet test --filter "FullyQualifiedName~RecorderTests"   # one test class
dotnet run --project src/StepRecorder.App                 # Windows only
dotnet format                                             # before committing
```

The solution builds on macOS/Linux (`EnableWindowsTargeting`), but only Windows can run the app. Core
tests run anywhere.

## Architecture

- **`StepRecorder.Core` (`net10.0`) must stay free of Windows APIs**, so it can be tested on any OS.
  Win32 code goes in `StepRecorder.Windows` (hooks, window lookup, capture, and later UI Automation),
  behind Core interfaces (`IMouseClickSource`, `IWindowInspector`, `IWindowCapture`,
  `IUiElementInspector`, `IScreenshotAnnotator`). UI goes in `StepRecorder.App`.
- **`Recorder` is the single state machine** (Idle → Recording ⇄ Paused → Idle). It is thread-safe,
  saves `session.json` on every transition, and raises `StateChanged` outside its lock. `TrayController`
  marshals that event and `StepsChanged` to the UI thread.
- **Click pipeline**: `LowLevelMouseHook` (own thread, installed only while Recording) → `ClickRecorder`
  bounded drop-oldest channel → single consumer → `IWindowInspector` → filters (own process, button
  settings) → `IWindowCapture` (PNG in memory) → `Recorder.AddStep`, which assigns the step number
  under its lock and writes `screenshots/step-NNN.png` through `ISessionStore`. Nothing slow may run in
  the hook callback. Later per-step work (UI Automation) also belongs in the consumer. A failed capture
  becomes `ScreenshotStatus.Unavailable` with a note, never an exception. Tests drive it with fakes and
  `ClickRecorder.FlushAsync()`.
- **Tray click removal**: opening our tray menu queues a marker that removes the trailing taskbar click
  that opened it (`ShellWindows`) and deletes its PNG. Anything that deletes steps must remove only
  trailing steps, so numbering and file names stay contiguous.
- **Reports**: `ReportBuilder` turns a `Session` into one `ReportModel`, which holds every display
  decision. `IReportExporter`s (HTML, Markdown) only render it. Add formats as new exporters, never by
  branching inside one. All session text must be HTML-encoded/Markdown-escaped, because window titles
  come from other apps. Links stay relative. The HTML click marker is CSS positioned from
  `ClickXRelativeToWindow / ScreenshotWidth` (ADR 0006).
- **Click markers** come from one `MarkerGeometry` (DPI-scaled, in screenshot pixels), used by both
  the HTML SVG overlay and `IScreenshotAnnotator` copies in `screenshots/marked/`. Never modify original
  screenshots (ADR 0007).
- **UI Automation** (ADR 0008): `UiaElementInspector` runs on a worker task alongside the capture, with a
  1.5 s timeout and at most one lookup in flight. Read identifying properties only (never values),
  and never log element names. `StepDescriber.DescribeRuns` turns them into `TextRun`s (bold names);
  plain `Describe` is for tests and alt text.
- **Repeat clicks**: the consumer merges a click that repeats the last one into that step's
  `ClickCount` (`RepeatClickDetector`, `Recorder.AddClickToLastStep`) before capturing.
- **Persistence**: `FileSessionStore` writes `session.json` atomically (temp file + rename). The session
  folder path is runtime-only (`[JsonIgnore] Session.Directory`). Never put absolute paths in
  `session.json`; screenshot paths are relative with forward slashes.
- **Settings** are immutable records. A section is added to `RecorderSettings` only when the milestone
  that uses it is built, and the settings window shows only settings that already work.
  `Session.RecordingSettingsSnapshot` freezes the settings a session was recorded with.
- **Coordinates** are physical virtual-desktop pixels. The app is Per-Monitor V2 DPI aware via
  `app.manifest` (that is why the project suppresses `WFO0003`).
- **WinForms is used only for `NotifyIcon`.** The `System.Windows.Forms`/`System.Drawing` global usings
  are removed; write those types with a `Forms.`/`Drawing.` alias.

## Working rules from the spec (§23, "Development Rules for All Agents")

- One milestone per change. Keep the app runnable after each. Don't build future milestones except for
  interfaces the current one needs.
- At the end of a milestone: build, test, update `docs/manual-tests.md` with that milestone's Windows
  checks, update the README status table, and report what was implemented, decisions, files changed, tests,
  build/test results, known limitations and the recommended next milestone. Stop for user review when an
  architecture decision or Windows limitation is still open.
- Record meaningful decisions as short ADRs in `docs/decisions/NNNN-title.md`, and document Windows API
  limitations in `docs/windows-limitations.md` instead of hiding them.
- Never log typed text, passwords or image data. No keystroke logging beyond explicit shortcuts
  (Milestone 8). No cloud dependencies in the recorder. No elevation or ways around capture protection.
- Capture/UI Automation failures are recoverable: record the step anyway, mark what's missing, and log it.

## Coding Conventions

- P/Invoke declarations live in `StepRecorder.Windows/NativeMethods.cs` (`DllImport`). Win32 calls on
  other apps' windows must not send them messages (a hung app would stall the recorder).
- C# with four-space indentation, PascalCase public members, camelCase locals and private fields
  (no underscore prefix)
- Namespace prefix `StepRecorder.*`; Core is split by folder: `Sessions`, `Recording`, `Input`, `Capture`, `Automation`, `Reporting`, `Settings`, `Storage`
- Tests: xUnit, class `RecorderTests`, method pattern `Stop_WhilePaused_CountsOpenPause`; use
  `ManualTimeProvider` and `TempDirectory` from `TestSupport.cs`
