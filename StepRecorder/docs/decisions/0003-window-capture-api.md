# 0003 — Window capture API

- Status: Accepted. Built in Milestone 3; Windows manual checks still pending.
- Date: 2026-10-05

## Options

| API | Occluded windows | GPU / Chromium / WinUI | Notes |
|---|---|---|---|
| `BitBlt` from the screen DC | No (copies whatever is on top) | Yes | Simple; captures overlapping windows too |
| `PrintWindow(PW_RENDERFULLCONTENT)` | Yes | Mostly (Win 8.1+) | Synchronous; a few apps render black |
| Windows.Graphics.Capture | Yes | Yes | Needs WinRT interop and a Win10 19041+ TFM; shows a yellow capture border unless `IsBorderRequired=false` (Win11, asks the user first) |

## Decision

`StepRecorder.Windows.Win32WindowCapture`, called from the `ClickRecorder` consumer (never from the hook):

1. Skip the capture and mark the step `Unavailable` when the window has closed, is minimized or has no
   area.
2. Re-read the visible frame (`DWMWA_EXTENDED_FRAME_BOUNDS`), in case the window moved since the lookup.
3. Unless the window is hung (`IsHungAppWindow`; `PrintWindow` would block on it), call
   **`PrintWindow(PW_RENDERFULLCONTENT)`** into a bitmap the size of `GetWindowRect`, then crop it to the
   frame. The bitmap is 32bpp RGB rather than ARGB, because GDI content has alpha 0 and would save
   transparent.
4. If that fails or the image is blank (all of 48×48 sampled pixels near black), **copy the frame
   area from the screen** (`Graphics.CopyFromScreen` = `BitBlt`). The step gets a note saying that
   overlapping windows may show. If the copy is blank too, it is kept, with a note that it may be blank,
   because some windows really are black.
5. If both fail, the step is recorded with `screenshotStatus: Unavailable` and the reason. Recording
   continues.
6. Clicks on the desktop (`Progman`/`WorkerW`) are recorded but not captured (`Skipped`), because the
   desktop spans every monitor (§9 "do not capture the entire desktop"). The taskbar *is* captured.

The image is encoded to PNG in memory. `Recorder.AddStep` then writes it as
`screenshots/step-NNN.png`, using the step number it assigns under its lock, so names follow step
numbers exactly. Removing trailing steps (the tray-menu click) deletes their screenshots. `Step` records
`screenshotStatus`, `screenshotPath` (relative), `screenshotWidth/Height`, `screenshotMethod` and
`screenshotNote`.

Windows.Graphics.Capture is kept as a later improvement in case the manual matrix shows `PrintWindow`
gaps that matter.

## Consequences

- Capture and PNG encoding run in the click consumer, so a slow capture (large or 4K windows) delays
  the *next* click's screenshot. If the manual tests show screenshots that show the state *after* later
  clicks, split it into two stages in Phase 5: grab pixels right away, then encode and write in a
  second queue.
- The screenshot is taken a few milliseconds after mouse-down, so fast apps may already show the
  pressed or opened state. "Before" screenshots are part of Phase 5/8 (before/after capture).

## Explicitly out of scope

The recorder does not try to get around `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, DRM-protected
surfaces or the secure desktop (§18 Security). Such windows come out black and get a note.
