# 0004 — DPI awareness and coordinate model

- Status: Accepted (Phase 0). The manifest ships in Milestone 1; coordinate handling is built in Milestones 2–4.
- Date: 2026-10-05

## Decision

- The process is **Per-Monitor V2 DPI aware**, declared in `app.manifest`. Without this, Windows
  virtualizes coordinates for windows on scaled monitors, and click points, window bounds and
  screenshots stop lining up.
- Every coordinate saved in `session.json` is in **physical screen pixels** of the virtual desktop.
  `ClickXRelativeToWindow`/`ClickYRelativeToWindow` are physical pixels from the top-left of the
  captured window image. That makes the click marker a plain offset with no scaling (§10).
- Coordinate maths (screen → window-relative, clamping, marker placement) lives in
  `StepRecorder.Core` as pure functions, so it can be unit-tested (§21).
- Each step also stores the window's DPI (`GetDpiForWindow`) for diagnostics.
