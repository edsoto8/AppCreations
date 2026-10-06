# 0002 — Global input hooks and window identification

- Status: Accepted. Built in Milestone 2; Windows manual checks still pending.
- Date: 2026-10-05

## Context

Milestone 2 needs global mouse clicks without slowing them down (§8, §18). Windows removes a low-level
hook that answers too slowly (`LowLevelHooksTimeout`), and from Windows 7 on it does this silently.

## Decision

- **`SetWindowsHookEx(WH_MOUSE_LL)`** runs on a **dedicated background thread with its own message loop**
  (`StepRecorder.Windows.LowLevelMouseHook`), not on the WPF UI thread. A busy UI can't stall it.
- **The hook is only installed while the state is Recording.** It is removed on Pause and Stop, so the
  recorder observes no input at all while idle or paused.
- The hook callback reads button, point and time, queues them, and returns `CallNextHookEx` at once. It
  never blocks, swallows or changes input. Only button *down* events are used (left, right, middle).
  Middle clicks are not recorded, because there is no setting for them.
- **`ClickRecorder` (Core)** owns a bounded channel (256 entries, drop-oldest, drops counted and logged)
  with a single consumer. The consumer looks up the window, applies filters and calls
  `Recorder.AddStep`, which numbers the step and saves `session.json`. A single consumer keeps steps in
  click order. A click still queued when the user pauses is dropped.
- Window identification (`Win32WindowInspector`):
  `WindowFromPoint` → `GetAncestor(GA_ROOT)` → `GetWindowThreadProcessId` →
  `QueryFullProcessImageName` (with `PROCESS_QUERY_LIMITED_INFORMATION`). The application name is the
  executable's `FileDescription` (cached), falling back to the exe name. Bounds come from
  `DWMWA_EXTENDED_FRAME_BOUNDS`, with `GetWindowRect` as the fallback. The window's DPI comes from
  `GetDpiForWindow`.
  - A popup (menu, drop-down) is its own root window and has no title, so it takes the title of its root
    owner (`GA_ROOTOWNER`). Bounds stay those of the popup.
  - The lookup runs on the consumer right after the click, usually before the target app has handled it.
    If the window closes first, the step is still recorded with only its screen position.
- **Self-filtering:** a click whose root window belongs to the recorder's own process (tray menu,
  settings, message boxes) is dropped. The tray icon itself lives in Explorer's taskbar, so the click that
  opens our menu would be recorded. When our `ContextMenuStrip` opens, a marker is queued behind that click.
  It removes trailing steps whose window class is a taskbar/tray class (`Shell_TrayWnd`,
  `Shell_SecondaryTrayWnd`, `NotifyIconOverflowWindow`, `TopLevelWindowForOverflowXamlIsland`) and that
  happened in the last 3 seconds. Ordinary taskbar clicks earlier in the session stay.
- Keyboard: no keyboard hook until Milestone 8. Even then, only modifier+key shortcuts are recorded,
  never plain typed text (§18 Security).

## Consequences

- `session.json` is rewritten after every step. At a few hundred bytes per step this is cheap for
  normal sessions (1,000 steps ≈ 0.5–1 MB per save, done off the input thread). If very long sessions
  show I/O cost, switch to an append-only step log (Phase 7).
- Known and suspected Windows limitations are tracked in `docs/windows-limitations.md`.
