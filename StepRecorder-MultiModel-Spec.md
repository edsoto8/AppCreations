# Step Recorder — Product & Implementation Specification

## 1. Project Overview

Build a lightweight Windows step-recording application that runs primarily from the system tray. The application records a user's interactions by detecting mouse clicks, identifying the window and UI element involved, and capturing a screenshot of the relevant application window rather than the entire desktop.

The application is intended as a modern replacement for Windows Steps Recorder, optimized for bug reproduction, QA evidence, troubleshooting, workflow documentation, and creation of step-by-step instructions.

The product should begin as a reliable local-only recorder and evolve into a smarter workflow/documentation tool. AI features are optional enhancements and must not be required for basic recording.

## 2. Product Principles

- **Invisible by default:** The recorder should live in the Windows system tray and avoid obstructing the user's workflow.
- **Capture context, not the desktop:** Prefer capturing the interacted-with application window rather than the full screen.
- **Local-first:** Recording must work without internet access or external services.
- **Privacy-aware:** Avoid capturing passwords and provide mechanisms for redacting sensitive content.
- **Useful output:** A recording should produce a readable report, not merely a directory of screenshots.
- **Progressive enhancement:** Advanced UI Automation and AI features should enrich basic recordings rather than being dependencies.
- **Recoverable:** A recording session should not be lost simply because the application crashes before the user presses Stop.

## 3. Target Platform and Suggested Technology

### Platform

- Windows 11 as the primary target.
- Windows 10 compatibility is desirable where practical but should not block development.

### Suggested Stack

- C# / modern .NET
- WinUI 3, WPF, or another suitable Windows desktop UI framework for settings/session management
- Windows system tray integration
- Windows Hooks / Win32 APIs for global mouse event monitoring
- Windows UI Automation for element identification
- Windows Graphics Capture, PrintWindow, BitBlt, or an appropriate Windows capture API for window screenshots
- System.Text.Json for session metadata
- HTML/CSS/JavaScript for generated reports
- xUnit or equivalent for automated tests

Choose the specific Windows UI framework and capture APIs after a short technical spike. Prefer reliability and maintainability over novelty.

## 4. Core User Experience

When Step Recorder launches, it should place an icon in the Windows system tray rather than opening a large application window.

The tray menu should initially provide:

- Start Recording
- Pause Recording / Resume Recording
- Stop Recording
- Open Last Recording
- Settings
- Exit

### Typical Workflow

1. User launches Step Recorder.
2. Step Recorder appears in the system tray.
3. User chooses **Start Recording**.
4. The application begins monitoring relevant user interactions.
5. User clicks controls in one or more applications.
6. For each meaningful interaction, Step Recorder captures the relevant application window and records metadata.
7. User optionally pauses and resumes the session.
8. User chooses **Stop Recording**.
9. Step Recorder finalizes the session and generates a report.
10. User opens the report or session folder from the tray menu.

## 5. Session Data Model

Each recording is a **Session** containing ordered **Steps**.

### Session

Suggested fields:

- SessionId
- Name
- StartedAt
- EndedAt
- Duration
- ApplicationVersion
- OperatingSystem
- StepCount
- SessionDirectory
- RecordingSettingsSnapshot

### Step

Suggested fields:

- StepNumber
- Timestamp
- EventType
- MouseButton
- CursorX
- CursorY
- ApplicationName
- ProcessId
- WindowHandle or equivalent runtime identifier
- WindowTitle
- WindowBounds
- ScreenshotPath
- ClickXRelativeToWindow
- ClickYRelativeToWindow
- UIAutomationElementName
- UIAutomationControlType
- UIAutomationAutomationId
- GeneratedDescription
- IsSensitive
- IsRedacted

Not every field must be populated in early milestones.

## 6. Storage Format

Each session should be self-contained.

Example:

```text
StepRecorder/
  Sessions/
    2026-10-05_175700_MyRecording/
      session.json
      report.html
      screenshots/
        step-001.png
        step-002.png
        step-003.png
      assets/
        report.css
        report.js
```

Use relative paths so the session folder can be moved or zipped without breaking the report.

Session metadata should be persisted incrementally during recording so an interrupted session can be recovered.

## 7. Milestone 1 — Application Shell

Create the minimum usable Windows tray application.

### Requirements

- Launch directly into the system tray.
- Do not require a main application window to remain open.
- Provide Start, Pause/Resume, Stop, Settings, and Exit commands.
- Clearly indicate recording state in the tray icon/menu.
- Prevent multiple simultaneous recording sessions.
- Create a new session directory when recording begins.
- Persist basic session metadata.

### Acceptance Criteria

- Application launches and remains usable from the tray.
- User can start, pause, resume, and stop a session.
- Exiting while recording requires safe session finalization or confirmation.
- Session folders are created predictably.
- No screenshots or global hooks are required yet.

## 8. Milestone 2 — Global Interaction Recording

Add global mouse monitoring and window detection.

### Requirements

- Detect global mouse clicks while recording.
- Ignore clicks generated by Step Recorder itself where appropriate.
- Record mouse button, timestamp, and screen coordinates.
- Determine which top-level window received or contains the click.
- Record process/application name and window title.
- Respect Pause state.
- Avoid noticeably delaying the user's click.

### Acceptance Criteria

- Clicking between applications produces correctly ordered step records.
- Paused sessions do not create new steps.
- Clicking applications on different monitors identifies the correct window.
- Recording remains stable during rapid normal interaction.

## 9. Milestone 3 — Window Screenshot Capture

Capture only the relevant application window for each recorded step.

### Requirements

- Capture the top-level application window associated with the click.
- Do not capture the entire desktop by default.
- Correctly handle windows positioned across multiple monitors where practical.
- Save screenshots with deterministic step numbers.
- Associate each screenshot with its Step record.
- Do not include Step Recorder overlays in captured output unless explicitly intended.

### Edge Cases

Investigate and document behavior for:

- Minimized windows
- UWP/WinUI applications
- Chromium/Electron applications
- Browsers
- Elevated/admin applications
- Windows protected surfaces
- Multiple monitors with different DPI scaling
- Partially off-screen windows
- Transparent or layered windows

If Windows security boundaries prevent capture of a particular window, record the step and mark screenshot capture as unavailable rather than crashing.

### Acceptance Criteria

- A click in Notepad captures the Notepad window rather than the entire desktop.
- A click in another application captures that application's window.
- Screenshot dimensions correspond to the captured window.
- Failures are logged and do not terminate the recording.

## 10. Milestone 4 — Click Visualization and Report Generation

Turn raw recording data into useful documentation.

### Click Highlighting

Add an optional visual marker showing the click location on the saved screenshot.

Suggested default:

- Circle/ring centered on the click location.
- Marker rendered into a report copy or screenshot copy rather than displaying an intrusive live overlay.
- Configurable enable/disable setting.

### HTML Report

Generate a self-contained report when the session ends.

Each step should show:

- Step number
- Timestamp
- Application name
- Window title
- Screenshot
- Click location indicator
- Basic action description

Example:

> Step 7 — Visual Studio  
> Click at (412, 218) in `MyApplication — Microsoft Visual Studio`.

### Acceptance Criteria

- Stopping a recording generates `report.html`.
- Report opens locally in a normal browser.
- Images use relative paths.
- Every captured step appears in chronological order.
- Click markers align with the actual click position.

## 11. Milestone 5 — UI Automation Intelligence

Use Windows UI Automation to identify the control the user interacted with.

### Requirements

For each interaction, attempt to retrieve:

- Element name
- Control type
- Automation ID
- Bounding rectangle
- Parent/control hierarchy where useful
- Whether the element is a password/sensitive field

Use this information to produce descriptions such as:

- Clicked **Save** button.
- Selected **Orders** tab.
- Clicked **Customer Name** text box.
- Selected **File > Export** menu item.

If UI Automation cannot identify an element, fall back gracefully to coordinates and window metadata.

### Acceptance Criteria

- Common native Windows controls are identified reliably.
- The recorder continues functioning for applications with incomplete UI Automation trees.
- UI Automation lookup does not significantly block interaction.
- Generated descriptions distinguish common control types.

## 12. Milestone 6 — Privacy and Sensitive Data Protection

The recorder must minimize accidental capture of sensitive information.

### Requirements

- Detect UI Automation password controls when possible.
- Never store typed password values.
- Allow users to define applications/windows that should never be captured.
- Allow screenshots to be manually redacted after recording.
- Support rectangular blur/redaction regions.
- Preserve the original only if the user explicitly chooses to do so; otherwise prefer privacy-safe output.
- Clearly mark redacted steps in metadata.

### Optional Advanced Detection

Explore local detection of likely sensitive fields such as:

- Passwords
- Credit card numbers
- Account numbers
- Email addresses
- Personally identifiable information

Automatic detection should be conservative and reviewable. Do not silently modify evidence without recording that a redaction occurred.

## 13. Milestone 7 — Session Viewer and Editor

Add a lightweight UI for reviewing a completed recording before export.

### Features

- List all steps.
- Preview screenshots.
- Rename the session.
- Edit generated step descriptions.
- Delete irrelevant steps.
- Reorder steps where appropriate.
- Add notes.
- Add arrows, rectangles, and text annotations.
- Add or remove click markers.
- Redact regions.
- Regenerate report after editing.

Keep recording available from the tray even if the viewer/editor is closed.

## 14. Milestone 8 — Smart Workflow Processing

Implement deterministic intelligence before adding external AI.

### Features

- Detect consecutive duplicate or near-duplicate screenshots.
- Optionally suppress accidental double-click duplicates.
- Group repeated actions where appropriate.
- Detect transitions between applications.
- Detect window-title changes.
- Identify long inactivity gaps.
- Support optional before/after capture for meaningful interactions.
- Record keyboard shortcuts such as Ctrl+C or Ctrl+S without indiscriminately logging typed text.
- Allow configurable hotkeys for Start, Pause, and Stop.

The raw event history should remain available even when the report groups or simplifies steps.

## 15. Milestone 9 — Export Formats

Support multiple outputs from the same session model.

### Required

- HTML

### Later

- Markdown
- PDF
- ZIP package containing report and assets
- JSON/raw session export

Design exporters behind an interface so additional formats can be added without changing the recording engine.

## 16. Milestone 10 — Optional AI Post-Processing

AI must be an optional post-processing feature, not part of the core capture pipeline.

Potential capabilities:

### Step Description Generation

Transform raw information such as:

```text
Application: Settings
Window: Accounts
Element: Sign-in options
ControlType: ListItem
Action: Click
```

into:

> Open **Sign-in options** under Accounts.

### Workflow Cleanup

AI may:

- Rewrite awkward descriptions.
- Remove or flag redundant steps.
- Group related interactions.
- Add section headings.
- Produce a concise version and detailed version.

### Bug Report Generation

Generate a structured report containing:

- Summary
- Reproduction steps
- Observed behavior
- Environment metadata
- Attached screenshots

The AI must not invent an expected result or root cause unless the user provides that information.

### Documentation Generation

Convert a recording into:

- User guide
- SOP
- Knowledge-base article
- QA evidence
- Training instructions
- Test-case draft

### Privacy

Before sending anything to a remote AI service, clearly show what information will leave the machine and require explicit user action. Provide a local-only mode in which AI integration is disabled.

## 17. Settings

Initial settings should include:

### Recording

- Capture on left click
- Capture on right click
- Record keyboard shortcuts
- Duplicate-step suppression
- Before/after screenshots

### Screenshot

- Image format
- Image quality where applicable
- Click marker enabled
- Click marker size

### Privacy

- Excluded applications
- Excluded window-title patterns
- Password-field protection
- Default redaction behavior

### Storage

- Default recordings directory
- Session naming convention
- Automatic cleanup policy, disabled by default

### Hotkeys

- Start recording
- Pause/resume
- Stop recording

## 18. Non-Functional Requirements

### Performance

- Global event handling must add negligible perceptible latency.
- Screenshot processing should occur asynchronously where safe.
- Avoid unbounded memory growth during long sessions.
- Use a bounded processing queue if capture events arrive faster than screenshots can be processed.

### Reliability

- A failed screenshot must not end the recording.
- A failed UI Automation lookup must fall back to basic metadata.
- Persist session state incrementally.
- Recover incomplete sessions after an unexpected crash where feasible.

### Security

- Do not require administrator privileges for normal operation.
- Do not attempt to bypass Windows security boundaries.
- Do not capture secure desktops or protected content through circumvention techniques.
- Never implement a general-purpose keylogger. Keyboard recording should be limited to explicit shortcuts/actions needed for documentation.

### Logging

Implement structured application logging for diagnostics. Logs should not contain passwords, arbitrary typed text, or screenshot image data.

### Accessibility

Settings and session-management UI should support keyboard navigation and standard Windows accessibility practices.

## 19. Suggested Architecture

Keep components separated so recording can evolve independently from presentation/export.

Suggested projects/modules:

```text
StepRecorder.sln
  StepRecorder.App
    Tray integration
    Settings UI
    Session viewer/editor

  StepRecorder.Core
    Session model
    Step model
    Recording state machine
    Interfaces

  StepRecorder.Input
    Global mouse hooks
    Keyboard shortcut monitoring

  StepRecorder.Windows
    Window discovery
    UI Automation
    DPI/monitor handling

  StepRecorder.Capture
    Window screenshot engine
    Click-marker rendering
    Image processing

  StepRecorder.Storage
    Session persistence
    Settings persistence
    Recovery

  StepRecorder.Reporting
    HTML exporter
    Markdown exporter
    Other exporters

  StepRecorder.AI
    Optional AI abstractions and providers

  StepRecorder.Tests
```

Avoid unnecessary project fragmentation if it slows early development; logical separation is more important than the exact number of assemblies.

## 20. Important Engineering Decisions to Validate Early

Before building the advanced milestones, create focused technical spikes for:

1. Reliable global mouse hooks in modern .NET.
2. Correct identification of the top-level window under the cursor.
3. Capturing a window even when another window partially overlaps it, if supported by the selected API.
4. Per-monitor DPI awareness and coordinate translation.
5. UI Automation element lookup from click coordinates.
6. Behavior when recording elevated applications from a non-elevated recorder.
7. Capture behavior for browsers, Electron applications, WinUI applications, and GPU-rendered windows.

Document limitations instead of hiding them.

## 21. Testing Strategy

### Unit Tests

Prioritize tests for:

- Recording state machine
- Session persistence
- Step numbering
- Coordinate transformations
- Duplicate-step detection
- Report generation
- Redaction metadata

### Integration Tests

Create small test windows containing common controls:

- Button
- Text box
- Password box
- Checkbox
- Combo box
- Tabs
- Menu
- Scrollable region

Use these to validate UI Automation and screenshot behavior.

### Manual Test Matrix

Test at minimum:

- Single monitor
- Multiple monitors
- Mixed DPI scaling
- 100%, 125%, 150%, and 200% scaling where available
- Light/dark Windows themes
- Native Windows applications
- Chrome/Edge
- Electron application
- .NET/WPF or WinUI application
- Elevated application
- Long recording session

## 22. Definition of Done for Initial Release

The first production-worthy release does **not** need every advanced feature.

Version 1 is complete when a user can:

1. Install/run Step Recorder.
2. Start recording from the system tray.
3. Interact normally with Windows applications.
4. Have each meaningful mouse click recorded.
5. Capture only the relevant application window rather than the full desktop.
6. See the click location highlighted.
7. See application/window context for each step.
8. Stop the recording.
9. Receive a readable HTML report.
10. Reopen the most recent recording.
11. Record for an extended period without crashes or runaway resource usage.

UI Automation descriptions are strongly desired for V1 if reliable, but the application must remain useful when they are unavailable.

## 23. Development Instructions for Claude Code / Opus

Implement this project incrementally.

### Rules

1. Do not attempt all milestones in a single change.
2. Start with Milestone 1 and keep the application runnable after every milestone.
3. Before each milestone, inspect the existing implementation and write a concise implementation plan.
4. Add or update tests for new non-UI behavior.
5. Run build and tests before considering a milestone complete.
6. Do not silently ignore compiler warnings introduced by new code.
7. Prefer simple, maintainable Windows APIs and abstractions over premature generalization.
8. Do not add cloud dependencies to the core recorder.
9. Do not implement unrestricted keystroke logging.
10. Treat capture failures and unsupported applications as recoverable conditions.
11. Record important Windows API limitations in project documentation.
12. Keep privacy protections explicit throughout the design.

### Milestone Completion Output

At the end of each milestone, provide:

- What was implemented
- Important architecture decisions
- Files/components added or changed
- Tests added
- Build/test results
- Known limitations
- Recommended next milestone

Do not begin the next milestone automatically if a significant architecture decision or unresolved technical limitation requires user review.

## 24. Future Ideas

Potential features beyond the initial roadmap:

- Screen/video recording synchronized with steps
- OCR-based context extraction
- Scroll stitching for long pages
- Automatic screenshot cropping around the relevant control
- Search across previous recordings
- Reusable documentation templates
- Compare two recordings
- Generate automated UI-test skeletons from recordings
- Integration with issue trackers
- Integration with documentation platforms
- Team-shared recording packages
- Portable viewer
- Recording tags and categories
- Session timeline visualization
- Voice notes attached to steps
- Optional local vision-language model support

## 25. Product Direction

The long-term goal is not simply to recreate Windows Steps Recorder. The application should become a lightweight **workflow recorder and documentation generator**.

The core value proposition is:

> Record what the user did, understand enough context to describe it, capture only what matters, protect sensitive information, and turn the session into documentation that is immediately useful.

The core recording pipeline should therefore remain modular:

```text
User Input
    ↓
Global Event Monitoring
    ↓
Window Identification
    ↓
UI Automation Context
    ↓
Window Capture
    ↓
Step/Event Engine
    ↓
Session Persistence
    ↓
Report / Export Generation
    ↓
Optional AI Post-Processing
```

---

# Multi-Model AI Development Strategy

## Purpose

This section defines how the project should be implemented when using **Opus, Sonnet, and Fable together with specialized sub-agents**. The product requirements above remain authoritative. The model strategy controls how work is planned, delegated, implemented, reviewed, and integrated.

## Model Roles

### Opus — Architect and Escalation Model

Use Opus for work requiring broad reasoning, architecture decisions, unfamiliar Windows behavior, or difficult debugging.

Primary responsibilities:
- Initial architecture and technical spike decisions.
- Selecting the Windows UI framework and screenshot/capture strategy.
- Designing boundaries between hooks, capture, session storage, UI Automation, reporting, and UI.
- Difficult Win32, DPI, multi-monitor, foreground-window, and UI Automation problems.
- Privacy/redaction architecture.
- Major refactors or cross-cutting changes.
- Reviewing architecture at major milestone boundaries.
- Diagnosing issues after Sonnet has made a reasonable implementation/debugging attempt.

Opus should generally **design or review rather than own routine implementation**.

### Sonnet — Lead Implementer and Integrator

Sonnet owns the main implementation flow and should be considered the lead engineering agent.

Primary responsibilities:
- Read this entire specification before implementation.
- Convert milestones into implementation tickets.
- Implement core application functionality.
- Integrate work produced by Fable and specialist sub-agents.
- Maintain architectural consistency.
- Run builds and tests after changes.
- Resolve ordinary integration problems.
- Keep documentation current.
- Escalate genuinely architectural or difficult platform problems to Opus.

Sonnet owns the final integrated result for each milestone.

### Fable — Bounded Implementation Model

Use Fable for narrowly scoped tasks with explicit inputs, outputs, APIs, acceptance criteria, and file boundaries.

Good Fable tasks include:
- Data models and DTOs.
- JSON serialization/deserialization.
- Settings persistence.
- Filename/path helpers.
- Markdown report renderer.
- HTML report renderer once the report model is defined.
- Small UI components.
- Validation helpers.
- Unit tests for established behavior.
- Documentation updates.
- Mechanical refactors with explicit instructions.

Do not ask Fable to independently redesign architecture, choose capture technologies, solve ambiguous Win32 behavior, or perform broad cross-project refactors.

## Sub-Agent Structure

Sub-agents are specialists. They advise, implement bounded work, or review. **Sonnet remains the integration owner.** Avoid allowing multiple agents to make overlapping architectural changes simultaneously.

### Windows Platform Agent
Owns expertise around:
- Global mouse hooks.
- Win32 window discovery.
- Window handles and process metadata.
- Screenshot/capture APIs.
- DPI scaling.
- Multi-monitor behavior.
- UI Automation.
- Windows security/elevation edge cases.

Recommended model: Opus for difficult platform design/debugging; Sonnet for established implementation.

### Application Core Agent
Owns:
- Recording state machine.
- Session lifecycle.
- Step model.
- Persistence.
- Crash recovery.
- Settings.
- Service boundaries and dependency injection.

Recommended model: Sonnet, with bounded pieces delegated to Fable.

### Reporting Agent
Owns:
- Shared report view model.
- Markdown renderer.
- HTML renderer.
- Relative screenshot paths.
- Report assets.
- Export consistency.

Recommended model: Fable for well-defined renderers; Sonnet reviews and integrates.

### QA / Test Agent
Owns independent verification rather than feature design.

Responsibilities:
- Derive tests from acceptance criteria.
- Add unit/integration tests where practical.
- Build a manual Windows test matrix.
- Test multi-monitor and DPI scenarios.
- Test pause/resume and interrupted sessions.
- Test report portability.
- Test privacy behavior.
- Report reproducible failures without silently changing requirements.

Recommended model: Sonnet or Fable depending on complexity.

### Code Review Agent
Runs after meaningful milestone implementations.

Review for:
- Correctness.
- Resource leaks and hook cleanup.
- Threading/race conditions.
- Error handling.
- Security/privacy problems.
- Excessive coupling.
- Duplicate logic.
- Missing tests.
- Scope creep.

Recommended model: Opus at major architectural checkpoints; Sonnet for routine reviews.

## Development Rules for All Agents

1. Do not implement future milestones unless required to establish an interface needed by the current milestone.
2. Do not silently change product requirements.
3. Prefer simple, testable abstractions over speculative frameworks.
4. Keep Windows-specific code behind explicit interfaces where practical.
5. A milestone is not complete merely because code was written.
6. At the end of every milestone: restore dependencies, build, run automated tests, perform the milestone's manual checks, fix failures, and summarize changes.
7. Do not leave knowingly broken builds for another agent.
8. Record meaningful architectural decisions in `/docs/decisions/` as short ADR-style Markdown files.
9. Avoid parallel agents editing the same files.
10. Sonnet decides integration order and owns merges between agent outputs.

## Recommended Implementation Sequence

### Phase 0 — Technical Spike
**Lead: Opus**  
**Support: Windows Platform Agent**

Determine:
- WPF vs WinUI 3 for the tray/settings shell.
- Tray integration approach.
- Best initial capture API for reliable per-window capture.
- Global mouse-hook approach.
- DPI/multi-monitor strategy.
- Project boundaries and interfaces.

Deliverable: short architecture decision document and solution skeleton recommendation. Do not build the full product during the spike.

### Phase 1 — Application Shell
**Lead: Sonnet**  
**Delegation: Fable for simple settings/model classes**

Implement the tray application, recording state machine, session creation, Start/Pause/Resume/Stop, settings shell, and safe exit behavior.

Gate: application builds, launches into the tray, transitions state correctly, and creates session metadata.

### Phase 2 — Global Interaction Detection
**Lead: Sonnet**  
**Specialist: Windows Platform Agent**  
**Escalation: Opus if hook/window behavior is unreliable**

Implement global click observation and identify the relevant top-level window without blocking the input thread.

Gate: clicks across ordinary applications are recorded reliably and the recorder does not capture its own tray/settings interactions unless explicitly intended.

### Phase 3 — Window Screenshot Capture
**Lead: Sonnet**  
**Specialist: Windows Platform Agent**  
**Architecture review: Opus**

Capture only the relevant application window, associate it with the step, save PNG output, and support multi-monitor/DPI behavior.

Gate: representative Win32, WPF/WinUI, browser, and common desktop windows capture correctly enough for MVP use.

### Phase 4 — Core Reporting
**Lead: Sonnet**  
**Implementation tickets: Fable / Reporting Agent**

Create a shared report model and generate:
- `report.md`
- `report.html`

Both formats must reference the same session data and screenshots. Users may select Markdown, HTML, or both. Relative paths are mandatory.

Gate: a completed session can be moved to another directory and both reports still render correctly.

### Phase 5 — Click Highlighting and Capture Polish
**Lead: Sonnet**  
**Support: Fable for isolated image/coordinate helpers**

Add configurable click markers, duplicate suppression where useful, image quality/settings, and capture robustness.

Gate: markers correspond correctly to click locations under supported DPI and monitor configurations.

### Phase 6 — UI Automation Intelligence
**Lead: Opus for design, Sonnet for implementation**  
**Specialist: Windows Platform Agent**

Capture UI Automation metadata when available:
- Element name.
- Control type.
- Automation ID.
- Bounds.

Generate useful descriptions such as `Clicked "Save" button in "Invoice Editor"` while gracefully falling back to coordinate/window information when UI Automation is unavailable.

Gate: UI Automation improves reports without becoming a dependency for recording.

### Phase 7 — Reliability, Recovery, and Developer Mode
**Lead: Sonnet**  
**Fable: bounded persistence/report additions**

Add:
- Incremental session persistence.
- Recovery of interrupted recordings.
- Developer mode with additional process/window/UIA diagnostics.
- Improved logs.
- Bug-reproduction packaging/export.

Gate: force-closing the recorder during a session does not destroy previously recorded steps.

### Phase 8 — Privacy and Redaction
**Lead: Opus for threat/privacy design, Sonnet for implementation**

Add privacy controls such as:
- Excluded applications/windows.
- Sensitive UI element detection where feasible.
- Manual redaction.
- Configurable privacy defaults.

Never claim automatic sensitive-data detection is perfect.

### Phase 9 — Post-MVP Snipping-Tool-Inspired Features
**Lead: Sonnet**  
**Fable: isolated editing/rendering tasks**

Only after the recorder is stable, consider:
- Crop.
- Rectangle/box annotation.
- Arrow annotation.
- Freehand markup.
- Text annotations.
- Numbered callouts.
- Blur/redaction tools.
- OCR/text extraction.
- Copy selected screenshot or annotated image.

These features must not delay the core recorder MVP.

### Phase 10 — Optional AI-Assisted Documentation
**Lead: Opus for design; Sonnet integration**

Optional and strictly additive:
- Summarize a session.
- Rewrite raw steps into cleaner instructions.
- Group repetitive actions.
- Suggest a bug title/reproduction summary.
- Produce QA documentation from captured steps.

The recorder must remain fully useful without an AI service.

## Ticket Format for Delegation

Whenever Sonnet delegates work to Fable or a sub-agent, provide a bounded ticket using this template:

```markdown
# Task
<single concrete objective>

## Context
<only the architecture/context required for this task>

## Files You May Modify
- <explicit paths>

## Inputs / Existing Interfaces
- <interfaces/types/contracts>

## Requirements
1. ...
2. ...

## Non-Goals
- ...

## Acceptance Criteria
- ...

## Verification
- Build command
- Test command
- Manual check if needed

## Return
Summarize files changed, tests run, and any unresolved issue. Do not redesign unrelated code.
```

## Model Escalation Policy

Use the least expensive/capable model that can reliably own the task, but escalate based on complexity rather than repeatedly prompting a struggling model.

- **Fable -> Sonnet:** ambiguous requirements, integration changes, several interacting services, or repeated test failures.
- **Sonnet -> Opus:** architecture changes, difficult Win32/UI Automation behavior, concurrency problems, unexplained capture failures, major refactors, or privacy/security design.
- **Opus -> Sonnet:** once the difficult decision/problem is resolved, return implementation ownership to Sonnet.

## Definition of Done for Every Milestone

A milestone is complete only when:
- Requirements and acceptance criteria are satisfied.
- Solution builds cleanly.
- Relevant automated tests pass.
- Required manual Windows tests pass.
- No known critical regression remains.
- Logging/error handling is sufficient to diagnose failures.
- Documentation is updated.
- QA/Test Agent has reviewed the acceptance criteria.
- Sonnet has integrated and reviewed delegated work.
- Opus review has occurred when the milestone is marked as an architectural checkpoint.

## MVP Finish Line

The MVP is complete when a user can launch the tray application, start recording, interact with multiple Windows applications, have each meaningful click captured as a screenshot of the relevant window, stop recording, and receive a portable session containing screenshots, metadata, and a readable Markdown and/or HTML report.

UI Automation enrichment, annotations, OCR, AI summarization, and sophisticated privacy automation are enhancements and must not prevent reaching this finish line.
