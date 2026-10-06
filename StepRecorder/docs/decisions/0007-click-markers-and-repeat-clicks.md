# 0007 — Click markers, repeat clicks and screenshot format

- Status: Accepted (Phase 5). Windows manual checks still pending.
- Date: 2026-10-05

## Click markers

- **One geometry, two renderers.** `MarkerGeometry.For(step, imageW, imageH, settings)` returns a ring
  centred on the window-relative click, in screenshot pixels. Its diameter is
  `ClickMarkerSize × WindowDpi / 96` and its stroke is about diameter/10. The ring therefore looks the
  same size on 100% and 200% monitors, which is the Phase 5 gate.
  - The **HTML report** draws it as an inline SVG over the image (`viewBox` = image size), so it scales
    exactly with the picture. This replaces the fixed-size CSS ring from Phase 4.
  - **Burned-in copies** (`IScreenshotAnnotator`, implemented with System.Drawing in
    `StepRecorder.Windows.ScreenshotAnnotator`) draw the same circle with the same colors (red
    `#E3262F` ring, 85% white halo) into `screenshots/marked/step-NNN.*`. They are made only when a
    format needs them (Markdown) and rebuilt from scratch each time reports are generated, so turning
    markers off or changing the size takes effect on the next report.
- **Originals are never modified.** They are the evidence (§12, §14).
- Markers follow the *current* settings at report time, not the session snapshot. They are a
  presentation choice, and the Milestone 7 editor will toggle them per step.

## Repeat clicks (spec §17 "duplicate-step suppression")

- A click that repeats the previous one becomes `clickCount` 2, 3, … on the existing step, instead of
  a new step with a screenshot of the first click's result. "Repeats" means same button, same root
  window, within 6 physical pixels, and within 500 ms of the *previous* click (so triple-clicks chain).
  The description reads "Double-click …" / "Double right-click …".
- Done in the `ClickRecorder` consumer, after the window lookup (the window must match) and before
  capture (no second screenshot). `Recorder.AddClickToLastStep(n)` only succeeds while step *n* is still
  last, so a removed tray click can never be extended.
- `RecordingSettings.MergeDoubleClicks` (default on) is snapshotted per session.
- 500 ms and 6 px are fixed constants rather than the user's Windows double-click settings, so Core
  stays platform-neutral. Revisit if testers report merges that are wrong.

## Screenshot format

- `ScreenshotSettings`: `Format` (PNG default / JPEG), `JpegQuality` (10–100, default 85),
  `ClickMarkerEnabled`, `ClickMarkerSize` (12–96, default 32). Out-of-range values are clamped on load.
  The format and quality are snapshotted per session (`screenshotSettingsSnapshot`) and passed to
  `IWindowCapture.Capture`. JPEG files are `step-NNN.jpg`.

## Deliberately not done in Phase 5

- The two-stage capture/encode split from ADR 0003 is still waiting for manual-test data. Captures
  slower than 250 ms are now logged ("Slow capture: … ms"), so the 3.16 / 5.x checks can show whether
  it is needed.
