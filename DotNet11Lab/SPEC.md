# SPEC — DotNet 11 Lab

## Vision

An interactive laboratory where a developer can find out **why .NET 11 matters** by running real experiments.
It is not a CRUD app or a gallery of snippets. Each lab runs real code on the runtime serving the page, shows the
exact source that ran, compares it with the previous (.NET 10 / C# 14) approach, and measures the difference.

## Users

- **.NET developers** upgrading from .NET 8–10 who want to know what to adopt, and when not to.
- **Tech leads** who need evidence (measurements, compatibility status) to plan an upgrade.
- **Educators** who need a runnable, accurate teaching aid.

## Functional requirements

| # | Requirement | Where |
|---|---|---|
| F1 | Sidebar navigation grouped by category, with light and dark themes | `MainLayout`, `NavMenu`, `theme.js` |
| F2 | Each lab shows its features with a status (Stable / Opt-in / Experimental / Baseline), a "New in 11" flag and Microsoft Learn links | `LabCatalog`, `LabHeader` |
| F3 | Code shown in the UI is the code that runs (embedded at build time and syntax highlighted) | `SourceCatalog`, `CodeBlock` |
| F4 | Each feature shows the previous approach next to the new one | `CodeCompare` |
| F5 | Demonstrations run live and display their results and timing; long runs can be cancelled | `DemoPanel` |
| F6 | Performance numbers are measured, never invented. Cross-runtime numbers come only from BenchmarkDotNet runs on both runtimes | Lab 5, `BENCHMARKS.md` |
| F7 | An API playground sends real HTTP requests and shows the raw request and response | Lab 3 |
| F8 | Experimental features are labelled and isolated from stable code | Lab 7, Lab 9, `experimental/` |
| F9 | Each feature includes guidance on when to use it and when to avoid it | `UsageGuidance` |
| F10 | A home page compatibility matrix for every feature | `FeatureTable` |

## Labs

1. **C# 15** – unions, closed hierarchies, collection expression arguments, extension indexers, labeled break/continue.
2. **LINQ** – `FullJoin` and tuple joins in an interactive financial reconciliation tool.
3. **ASP.NET Core 11** – async validation, OpenAPI 3.2, unions in JSON, ProblemDetails.
4. **Blazor 11** – async form validation, QuickGrid URL navigation, virtualization navigation, render modes and state.
5. **Runtime performance** – quick in-process measurements plus BenchmarkDotNet on .NET 10 and .NET 11, with a SQLite run journal.
6. **Libraries** – Zstandard, memory stream adapters, JSON Lines, System.Text.Json updates.
7. **Runtime Async** – opt-in, isolated in one assembly, inspected and compared live.
8. **Native AOT** – a companion CLI published three ways, with measured size, startup and memory.
9. **AI** – Microsoft.Extensions.AI with configurable providers, an offline mock, tool calling and MCP.

## Non-functional requirements

- Runs on Windows, macOS and Linux (x64/arm64) with only the .NET 11 SDK installed. Cross-runtime benchmarks
  also need the .NET 10 runtime. Native AOT needs the platform C toolchain.
- One command to start: `dotnet run --project src/DotNet11Lab.Web`.
- No hard-coded secrets. AI keys come from configuration, user-secrets or environment variables only.
- `TreatWarningsAsErrors`, nullable enabled, cancellation tokens passed through async code, and size caps on user input.
- Native .NET capabilities first. Every external dependency must justify itself (see ARCHITECTURE.md).
- Automated tests (xUnit v3 on Microsoft.Testing.Platform) for every lab's logic and HTTP surface.

## Acceptance criteria

- `dotnet build DotNet11Lab.slnx` succeeds with zero warnings.
- `dotnet test --solution DotNet11Lab.slnx` passes.
- Every lab page renders, and every Run button produces a result in a browser (checked with Playwright).
- Every snippet id referenced by a page exists in a compiled assembly (enforced by a test).
- Published benchmark and publish-comparison results come from recorded runs and carry the machine and date.

## Out of scope

- Authentication, multi-user persistence and cloud deployment.
- Calling a real AI provider in CI (the mock covers it; real providers are configuration-driven).
- Memory-safety rules (C# 15 preview, behind a compiler feature flag).
