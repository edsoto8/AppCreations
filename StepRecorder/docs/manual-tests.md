# Manual Windows tests

Automated tests cover `StepRecorder.Core`. The checks below need a real Windows desktop. Record the
result (✅/❌, Windows version, display scaling) next to each item when a milestone is checked.

## Milestone 1 — Application shell

Run with `dotnet run --project src/StepRecorder.App`, or start `StepRecorder.exe` from
`src/StepRecorder.App/bin/Debug/net10.0-windows/`.

| # | Check | Expected | Result |
|---|---|---|---|
| 1.1 | Launch the app | No window opens; a grey dot icon appears in the tray (check the `^` overflow) | |
| 1.2 | Hover the icon | Tooltip "Step Recorder – Not recording" | |
| 1.3 | Right-click → Start Recording | Icon turns red; menu top line says "Recording: Recording"; Start is greyed out | |
| 1.4 | Look in `Documents\StepRecorder\Sessions` | New `YYYY-MM-DD_HHmmss_Recording` folder holding `session.json` (`status: Recording`) and an empty `screenshots` folder | |
| 1.5 | Pause Recording | Icon turns amber with pause bars; item now reads "Resume Recording"; `session.json` says `Paused` | |
| 1.6 | Resume Recording | Icon red again; `session.json` says `Recording` | |
| 1.7 | Stop Recording | Icon grey; "Recording saved" notification; clicking it opens the folder; `session.json` has `status: Completed`, `endedAt`, `duration` and `activeDuration` (shorter than `duration` by the pause) | |
| 1.8 | Open Last Recording | Opens the folder from 1.7 | |
| 1.9 | Exit, relaunch, Open Last Recording | Still opens the folder from 1.7 (found on disk) | |
| 1.10 | Launch a second copy while one is running | "already running" message; still only one tray icon | |
| 1.11 | Start, then Exit → No | Still recording | |
| 1.12 | Exit → Yes | App exits; tray icon gone; session saved as `Completed` | |
| 1.13 | Settings… → change folder via Browse, change name to "Bug 42", Save; Start | New folder `…_Bug-42` in the chosen folder | |
| 1.14 | Settings… → type a relative path such as `foo` → Save | Inline error; window stays open | |
| 1.15 | Settings window, keyboard only | Tab reaches every control; Alt+R / Alt+N / Alt+B work; Enter saves; Esc cancels | |
| 1.16 | Point Settings at a folder you can't write to (e.g. `C:\Windows\System32\x`), Start | Clear error message; app keeps running, still idle | |
| 1.17 | Start, then sign out of Windows | After signing back in, `session.json` is `Completed` | |
| 1.18 | Start, kill the process in Task Manager | `session.json` remains valid JSON with `status: Recording` | |
| 1.19 | Light and dark taskbar | Icon readable in both | |
| 1.20 | 100% and 150%+ display scaling | Icon crisp; Settings window not blurry | |

## Milestone 2 — Global click recording

Check `session.json` in the session folder after each scenario. Tip: keep it open in a browser, which
renders JSON readably, and refresh it.

| # | Check | Expected | Result |
|---|---|---|---|
| 2.1 | Start; click in Notepad, then File Explorer, then Notepad again; Stop | 3 steps numbered 1–3 in click order, with matching `applicationName`, `processName`, `windowTitle` | |
| 2.2 | Hover the tray icon while recording | Tooltip shows the step count going up | |
| 2.3 | Right-click a window | Step with `mouseButton: Right` | |
| 2.4 | Middle-click a window | No step | |
| 2.5 | Pause; click around; Resume; click once | Only the click after Resume is recorded | |
| 2.6 | Right-click the tray icon → Stop Recording | The last step is **not** a taskbar / Explorer click | |
| 2.7 | While recording, open Settings… and click inside it | No steps from the Settings window or the tray menu | |
| 2.8 | Two monitors: click a window on each, including one left of/above the primary (negative coordinates) | Each step names the right window; `windowBounds` are on the right monitor; `clickXRelativeToWindow`/`Y` match where you clicked inside the window | |
| 2.9 | Mixed DPI (e.g. 100% + 150%): click near the bottom-right corner of a window on each monitor | Relative click position is close to (`windowBounds.width`, `windowBounds.height`); `windowDpi` is 96 or 144 to match the monitor | |
| 2.10 | Click as fast as you can for 10 seconds in one app | Clicks never feel delayed; step count matches roughly; no `Click queue full` in the log | |
| 2.11 | Open a menu in Notepad (File) and click an item | Menu steps have Notepad's title even though the popup has none | |
| 2.12 | Click Calculator or Settings (UWP) | Record what `applicationName` shows (see `windows-limitations.md`) | |
| 2.13 | Click Chrome/Edge and an Electron app (VS Code, Teams) | Steps name the browser/app and tab title | |
| 2.14 | Click an elevated app (e.g. Task Manager run as admin) | Record whether steps appear and what they contain | |
| 2.15 | Touch screen or pen, if you have one | Record whether taps become left-click steps | |
| 2.16 | Record for 30+ minutes of normal work | No crash; app memory (Task Manager) stays roughly flat; `session.json` stays valid | |

## Milestone 3 — Window screenshots

Open the session's `screenshots/` folder next to `session.json`.

| # | Check | Expected | Result |
|---|---|---|---|
| 3.1 | Click in Notepad | `step-001.png` shows only the Notepad window (no desktop, no taskbar); `screenshotMethod: PrintWindow` | |
| 3.2 | Then click File Explorer, then Notepad | `step-002.png` is Explorer, `step-003.png` Notepad; numbers match `stepNumber` | |
| 3.3 | Compare `screenshotWidth/Height` with the PNG's real size and `windowBounds` | All three match | |
| 3.4 | Click a window that is partly covered by another | The covered part still shows the clicked window's own content | |
| 3.5 | Drag a window partly off the screen edge, click it | The off-screen part is filled in (PrintWindow) | |
| 3.6 | Chrome/Edge (including a page with video) and an Electron app | Content visible, not black; note what video looks like | |
| 3.7 | Calculator / Settings (UWP), and a WinUI 3 app if available | Content visible; record `screenshotMethod` | |
| 3.8 | Elevated app (Task Manager as admin) | A screenshot (probably `ScreenCopy` with a note) or `Unavailable` with a reason, but never a crash | |
| 3.9 | Click the desktop | Step recorded with `screenshotStatus: Skipped`, no PNG | |
| 3.10 | Click the taskbar (e.g. the Start button) | PNG of the taskbar strip only | |
| 3.11 | Mixed DPI: click windows on a 100% and a 150% monitor | Both PNGs are sharp at native resolution and frame the window exactly | |
| 3.12 | Window on a monitor left of / above the primary | Correct window captured | |
| 3.13 | Right-click tray → Stop | No PNG left for the removed tray click; PNG count equals step count (minus desktop clicks) | |
| 3.14 | Pause; click around; Resume | No PNGs from the paused period | |
| 3.15 | Settings window and tray menu | Never appear in any PNG as a captured window | |
| 3.16 | Maximized 4K window: click 5 times quickly | Each PNG shows the state right after its own click, not a later one (see ADR 0003) | |
| 3.17 | 30-minute session with screenshots | Memory roughly flat in Task Manager; no `Screenshot failed` storms in the log | |
| 3.18 | Zip the session folder, extract it elsewhere | `session.json` paths still point to the PNGs | |

## Milestone 4 — Reports

| # | Check | Expected | Result |
|---|---|---|---|
| 4.1 | Record 5+ clicks across 2–3 apps; Stop | "Recording saved … N steps" notification; clicking it opens `report.html` in the browser | |
| 4.2 | Read the HTML report | Title, start time, duration and step count at the top; steps in order with app name, time, description and screenshot | |
| 4.3 | Check click markers | Each red ring sits exactly where you clicked, including on a 150% monitor and in a window left of the primary | |
| 4.4 | Click a screenshot in the report | It switches to full size; click again to fit | |
| 4.5 | Step whose screenshot failed or was skipped (desktop click) | Yellow note instead of an image | |
| 4.6 | Open `report.md` in VS Code preview (or paste into a GitHub issue together with the images) | Same steps and images; window titles with `*`, `_`, `[ ]` show literally | |
| 4.7 | Zip the session folder, extract it somewhere else, open both reports | All images still show (relative paths) | |
| 4.8 | Settings → untick Markdown → Save; record and stop | Only `report.html` (+ `assets/`) written | |
| 4.9 | Settings → untick both → Save | Inline error "Choose at least one report format." | |
| 4.10 | Tray → Open Last Recording | Opens the last `report.html` | |
| 4.11 | Kill the app mid-recording, restart, Open Last Recording | A report is generated for the interrupted session and labelled "Incomplete" | |
| 4.12 | Right-click tray → Stop quickly after opening the menu | The report does not end with a taskbar click | |
| 4.13 | Windows dark mode / light mode browser | Report readable in both; Print preview fits steps on pages without splitting a step | |
