# 0006 — Report model and exporters

- Status: Accepted (Phase 4 / Milestone 4). Click markers drawn into image copies come in Phase 5.
- Date: 2026-10-05

## Decision

- **One shared model** (`ReportBuilder.Build(session)` → `ReportModel`) holds every display decision:
  step order (by step number), headings ("Step 7 — Visual Studio"), descriptions, screenshot links,
  click markers and notes. Exporters only render it, so HTML and Markdown can never disagree (Phase 4
  requirement).
- **Exporters implement `IReportExporter`** (`FileName`, `Export(model, sessionDirectory)`). They are
  `HtmlReportExporter` (`report.html` + `assets/report.css` + `assets/report.js`) and
  `MarkdownReportExporter` (`report.md`). PDF/ZIP/JSON (§15) can be added without touching recording.
  `ReportGenerator` runs the formats enabled in `ReportSettings`. One failing format doesn't stop the
  others, and HTML is used if both are switched off.
- **Descriptions** (`StepDescriber`) are coordinate-based for now: `Click at (412, 218) in "Title".`
  Desktop and taskbar clicks get their own wording. A stored `Step.GeneratedDescription` (UI Automation in
  Milestone 5, user edits in Milestone 7) always takes priority.
- **Click marker in HTML** is a CSS ring positioned over the `<img>` with percentages
  (`ClickXRelativeToWindow / ScreenshotWidth`). It needs no image processing and stays aligned at any
  zoom. This works because the click offset and the screenshot share an origin: the window frame's
  top-left in physical pixels (ADR 0004). A click outside the image gets no marker.
  Markdown cannot overlay, so it states the position in text. Burned-in marker copies are Phase 5.
- **Portability:** every link is relative and percent-encoded, nothing loads from the network, and the
  page works without JavaScript (the script only toggles screenshot zoom). A test moves a generated
  session folder and checks that every `src`/`href` and Markdown image still resolves (the Phase 4 gate).
- **Safety:** all session text (titles, names, notes) is HTML-encoded or Markdown-escaped, because
  window titles come from other apps and can contain anything.
- **Format:** dates use `yyyy-MM-dd HH:mm:ss` in invariant culture, and percentages always use `.`.
  Reports read the same on every machine.
- **When reports are written:** on Stop (and on Windows sign-out), from the in-memory session, so a
  failed final save of `session.json` still produces a report. "Open Last Recording" opens the existing
  report. An interrupted session (crash) has none yet, so one is written at that point.
