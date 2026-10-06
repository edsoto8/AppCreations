# 0008 — UI Automation element identification

- Status: Accepted (Phase 6 / Milestone 5). Windows manual checks still pending.
- Date: 2026-10-05

## Decision

- **API:** the managed `System.Windows.Automation` client (UIA, shipped with the .NET Windows Desktop
  runtime via `UseWPF` in `StepRecorder.Windows`), so there is no third-party dependency.
  `UiaElementInspector` calls `AutomationElement.FromPoint` at the click's physical-pixel point with one
  `CacheRequest` (name, control type, localized type, automation ID, bounds, `IsPassword`). Every
  property therefore comes back in a single cross-process round trip. For menu items it walks up the
  control view through `MenuItem`/`Menu` ancestors (at most 8) to build `File > Export`.
- **Never read values.** No `ValuePattern`, no text: only identifying properties. Password fields are
  detected with `IsPassword`, which sets `Step.IsSensitive`, and reports show a "Password field" badge.
  Element names are not written to the log, because list items or documents can contain user content.
- **It must not block** (spec §11). UIA calls block while the target app is busy, so in
  `ClickRecorder`:
  - the lookup starts on a worker task *at the same time as* the screenshot, so both see the UI as close
    to the click as possible and UIA adds no delay when it is faster than the capture;
  - the click waits for it at most **1.5 s from the lookup's start**, then records the step without
    control details;
  - while one lookup is still running (a hung app), later clicks skip UIA, so hung calls cannot pile up
    threads. Lookups resume once it returns;
  - lookup exceptions are caught on the worker, so the step is recorded with window and coordinate
    information (§11 fallback);
  - merged double-clicks and the recorder's own windows are never looked up.
- `RecordingSettings.IdentifyControls` (default on, per-session snapshot) turns it off for apps that
  misbehave while being inspected.

## Descriptions

`StepDescriber` returns runs (plain text plus emphasized names), rendered as `<strong>` in HTML and
`**…**` in Markdown. Its order of preference:

1. a stored `GeneratedDescription` (edits/AI, later milestones);
2. the control: `Click the **Save** button in **Invoice Editor**.` / `Select the **Orders** tab …` /
   `Click the **Customer Name** text box …` / `Select the **File > Export** menu item …`. A plain
   left click on a selectable item (tab, list/tree item, option, menu item) says "Select". Right- and
   double-clicks keep their verb. Desktop and taskbar elements say "on the desktop"/"on the taskbar".
   Unknown types use UIA's localized type name;
3. desktop/taskbar wording without a control;
4. coordinates: `Click at (412, 218) in **Title**.`

An element that only describes the window (type `Window`, or a `Pane`/`Group`/`Custom` named like the
window) falls back to coordinates, which are more useful there.

**Wording note:** the spec's examples mix tenses ("Clicked **Save** button", "Click at (412, 218)").
Reports use the instruction form ("Click …", "Select …") throughout, so a report reads as
reproduction steps. Switching to past tense is a one-line change in `StepDescriber.Sentence`.
