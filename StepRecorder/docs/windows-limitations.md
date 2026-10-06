# Windows limitations

Known and suspected limits of the Windows APIs the recorder uses. "Suspected" items come from API
documentation and have not yet been checked on a real machine. Update each one with what the manual
tests in `manual-tests.md` actually show.

The recorder never asks for elevation, never tries to get around a security boundary, and never
captures the secure desktop (spec §18).

## Click recording (Milestone 2)

| Situation | Expected behavior | Status |
|---|---|---|
| Elevated (admin) app, recorder not elevated | UIPI may stop the low-level hook from seeing clicks aimed at elevated windows. If clicks are seen, window title and process name should still resolve (`PROCESS_QUERY_LIMITED_INFORMATION` usually works). Steps may be missing. | Suspected |
| UAC prompt, Ctrl+Alt+Del, lock screen | Secure desktop: no clicks are seen. | Expected by design |
| Window closes in response to the click (e.g. a dialog's OK button) | The lookup normally runs before the app handles the click. If it loses the race, the step keeps only its screen position, with no window details. | Suspected rare |
| Popup menus and drop-downs | Recorded against the popup window; the title comes from the owning app window. | By design |
| UWP / packaged apps (Calculator, Settings) | Root window is `ApplicationFrameWindow`, owned by `ApplicationFrameHost.exe`. Since Phase 5 the inspector names the step after the process that owns the hosted `Windows.UI.Core.CoreWindow` child, so it shows "Calculator" rather than "Application Frame Host". If the child isn't found (e.g. a suspended app), the frame host name remains. | Fix built; untested |
| Touch and pen | Windows turns them into mouse events, which the hook sees as left clicks. | Suspected |
| Remote Desktop / injected input (automation tools) | Injected clicks are recorded like real ones. | Suspected |
| Hung application | The window lookup sends no messages to the target, so a hung app can't stall the recorder. | By design |
| Hook removed by Windows after timeouts | The callback only queues, so this shouldn't happen. If it does, clicks stop arriving silently. A watchdog is a possible later addition. | Untested |
| Clicking the tray icon to open the recorder's menu | That click is removed from the session. Clicking the tray icon without opening the menu (left click) is recorded as a taskbar click. | By design |

## Window screenshots (Milestone 3)

Spec §9 edge cases. `screenshotMethod` and `screenshotNote` in `session.json` show what happened for
each step.

| Situation | Expected behavior | Status |
|---|---|---|
| Minimized window | Can't really be clicked; if it happens, `Unavailable` ("minimized"). | By design |
| UWP / WinUI apps | `PrintWindow(PW_RENDERFULLCONTENT)` should capture them; a black result falls back to a screen copy. | Suspected |
| Chromium / Electron / browsers | Captured with `PW_RENDERFULLCONTENT`. Hardware-accelerated video may be black. | Suspected |
| Elevated (admin) apps | UIPI may block `PrintWindow`; the screen copy still works, so overlapping windows may show. | Suspected |
| Protected surfaces (DRM video, `WDA_EXCLUDEFROMCAPTURE` windows such as some password managers) | Black image with a "may be blank" note. Never worked around. | By design |
| Secure desktop (UAC, lock screen) | Screen copy fails; `Unavailable`. | Expected by design |
| Mixed-DPI monitors | The process is Per-Monitor V2 aware, so bounds and pixels are physical and the image is native size. A window spanning two monitors is rendered at its own DPI. | Suspected |
| Partially off-screen windows | `PrintWindow` renders the off-screen part; the screen-copy fallback shows black there. | Suspected |
| Transparent / layered windows | Transparent areas come out black (24-bit PNG). | Suspected |
| Hung apps | `PrintWindow` is skipped (it would block); screen copy used. | By design |
| Windows 11 rounded corners | The corner pixels outside the rounded frame may be black or show the background. | Suspected cosmetic |
| Desktop clicks | Not captured (`Skipped`): the desktop spans every monitor. | By design |
| Very large windows (4K+) | Capture and encoding can take 100 ms or more, which delays the next click's screenshot. | Suspected; see ADR 0003 |

## UI Automation (Phase 6)

| Situation | Expected behavior | Status |
|---|---|---|
| Win32, WinForms, WPF, UWP/WinUI controls | Name, type and automation ID come back reliably. | Suspected |
| Chromium / Electron / browsers | Chrome turns on its accessibility tree only when a UIA client asks, so the **first** click may only see "Chrome Legacy Window" (falls back to coordinates); later clicks should name page elements. Electron apps may not expose a tree at all. | Suspected |
| Elevated (admin) apps | UIPI stops a non-elevated client from inspecting elevated windows, so steps fall back to coordinates. | Suspected |
| Hung or very busy app | Lookup times out after 1.5 s; later clicks skip UIA until it returns. | By design |
| WinUI 3 / XAML flyout menus (Windows 11 Notepad, Explorer) | Flyouts aren't linked to their menu bar item in the UIA tree, so the menu path may be just "Save as" rather than "File > Save as". | Suspected |
| Custom-drawn apps (games, some Java/Qt apps, remote desktops) | No useful element: coordinates are used. | Expected |
| Password boxes | Detected via `IsPassword`; never read. Web password inputs depend on the browser exposing `IsPassword`. | Suspected |
| First lookup after start | Loading the UIA client takes about 100–300 ms; it runs alongside the capture. | Suspected |
