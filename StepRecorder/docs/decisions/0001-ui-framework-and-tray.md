# 0001 — UI framework and tray integration

- Status: Accepted (Phase 0). Still to be checked on real Windows 10/11 machines during Milestone 1 manual tests.
- Date: 2026-10-05

## Context

The recorder lives in the system tray (spec §4, §7). Later milestones need a settings window and a
session viewer/editor with screenshot annotation (§13). The spec suggests WinUI 3 or WPF.

## Decision

- **WPF on .NET 10** (`net10.0-windows`) for every window: settings now, the viewer/editor later.
- **`System.Windows.Forms.NotifyIcon`** for the tray icon and its context menu. The WPF project turns on
  `UseWindowsForms` only for this. The global usings for `System.Windows.Forms` and `System.Drawing` are
  removed, so WPF types win and WinForms types are always written with their full names.
- The app starts with `ShutdownMode=OnExplicitShutdown` and no startup window. It only exits through the
  tray's **Exit** command or when Windows is shutting down.
- **One instance only**, enforced with a named mutex. Together with the recorder state machine, this
  means there can never be two recordings at once.
- Tray icons are drawn in code (grey = idle, red = recording, amber = paused), so there are no binary
  assets to maintain.

## Why not WinUI 3

WinUI 3 has no built-in tray API. It also needs the Windows App SDK runtime, and its unpackaged
deployment story is still harder than WPF's. WPF is mature, ships in the .NET Windows Desktop runtime,
has a good canvas for annotation tools, and is easy to use with a keyboard and screen readers (§18).

## Consequences

- The app project builds on any OS (`EnableWindowsTargeting`), but only runs on Windows.
- Platform-neutral logic lives in `StepRecorder.Core` (`net10.0`), so it can be unit-tested anywhere.
