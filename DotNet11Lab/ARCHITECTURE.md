# Architecture — DotNet 11 Lab

## Solution layout

```
DotNet11Lab/
├─ global.json                    SDK 11.0.100; "test.runner": "Microsoft.Testing.Platform"
├─ Directory.Build.props          net11.0, LangVersion 15, nullable, TreatWarningsAsErrors, EmbedLabSources
├─ Directory.Packages.props       central package versions
├─ src/
│  ├─ DotNet11Lab.Core            lab logic (UI-free); one folder per lab under Labs/
│  ├─ DotNet11Lab.Api             Minimal API (Lab 3); runs standalone or hosted by Web
│  ├─ DotNet11Lab.Web             Blazor Web App dashboard; hosts /api and /openapi
│  ├─ DotNet11Lab.Benchmarks      BenchmarkDotNet, net10.0 + net11.0
│  └─ DotNet11Lab.Cli             dotnet11lab companion CLI (Native AOT capable)
├─ experimental/
│  └─ DotNet11Lab.RuntimeAsync    the ONLY assembly compiled with runtime-async=on
├─ tests/DotNet11Lab.Tests        xUnit v3 on Microsoft.Testing.Platform
├─ scripts/                       reproducible publish/benchmark scripts (bash + PowerShell)
└─ results/                       recorded measurement output read by the dashboard
```

## Dependency graph

```
            ┌──────────────┐
            │     Web      │──────────────┐
            └──┬───────┬───┘              │
               │       │                  ▼
               ▼       ▼          ┌────────────────┐
            ┌─────┐  ┌──────┐     │  RuntimeAsync  │ (experimental, opt-in feature)
            │ Api │─▶│ Core │     └────────────────┘
            └─────┘  └──────┘             ▲
                                          │ net11.0 only
   Benchmarks (net10.0;net11.0) ──────────┘      Cli (standalone, AOT)
   Tests ─▶ Core, Api, Web, RuntimeAsync, Cli
```

`Benchmarks` deliberately does **not** reference `Core`. Core targets net11.0 and uses C# 15, while the benchmarks
must compile the same workloads for net10.0 so the runtimes can be compared fairly.

## Key decisions

### 1. One process for the dashboard and the API
`DotNet11Lab.Api` exposes `AddLabApi()` / `MapLabApi()`. The Web host maps them under `/api`, so
`dotnet run --project src/DotNet11Lab.Web` gives you everything. The playground still sends **real HTTP
requests** to those endpoints. `ApiHost.Main` runs the same API alone on port 5181.

The Api project uses `Microsoft.NET.Sdk` plus `<FrameworkReference Include="Microsoft.AspNetCore.App" />`, not
`Microsoft.NET.Sdk.Web`. When one Web-SDK project references another, the static-web-asset manifests clash
(`scoped css bundles do not have matching endpoints`). The ASP.NET Core validation source generator and OpenAPI still
work in this setup (verified: async validators run, and the document reports `3.2.0`). The entry point is an explicit,
namespaced `ApiHost` class, so it cannot clash with the dashboard's top-level `Program`.

### 2. "The code you see is the code that runs"
Projects with `EmbedLabSources=true` embed their own `*.cs` files as manifest resources (`labsrc/<Project>/<path>`).
`SourceCatalog` extracts regions marked `// <snippet:Id>` … `// </snippet:Id>`. The UI never shows hand-copied code,
and `SnippetReferenceTests` fails the build if a page references a snippet that does not exist.

### 3. A highlighter with no JavaScript
`CSharpHighlighter` is a small lexer that knows the C# 15 contextual keywords (`union`, `closed`, `extension`,
`with`). It returns tokens that Razor renders as encoded `<span>`s, so no source text ever becomes raw HTML and no JS
library is needed. Charts are CSS/HTML bars (`BarChart`) for the same reason.

### 4. Render modes
Pages render as **static SSR** by default, and lab pages that need interaction opt into `@rendermode InteractiveServer`.
This is the .NET 8+ per-page model. It keeps the shell fast and lets Lab 4 show a QuickGrid whose .NET 11 URL-based
paging works without a circuit. The theme toggle is plain JS, so it also works on static pages, and it re-applies after
Blazor's `enhancedload` event.

### 5. Independent lab modules
Each lab adds its registrations by implementing one `static partial void Register…Lab(...)` method of
`LabServiceRegistration` (Core) or `LabWebServices` (Web) in its own file. Labs share no mutable files, which is what
allowed them to be built in parallel.

### 6. Measurements are labelled by provenance
- **Quick measurements** (`Measure.Run`): in-process, current runtime, warm-up then timed loop, allocations counted
  per thread. Good for interactive "what changes if I do X" questions. Labelled as quick.
- **BenchmarkDotNet results**: separate processes per runtime (.NET 10 and .NET 11) with statistical analysis,
  exported to `results/benchmarks/latest.json` together with machine information. The dashboard shows this file
  as-is. When it is missing, the dashboard shows the command that produces it, never placeholder numbers.
- **Publish comparison**: `scripts/publish-compare.*` publishes the CLI three ways and records size, startup and
  memory in `results/publish/latest.json`.

### 7. Experimental isolation
- Runtime Async is enabled per assembly, only in `experimental/DotNet11Lab.RuntimeAsync`.
- `Microsoft.AspNetCore.Components.AI` (prerelease) is not referenced by any stable project.
- C# 15 memory-safety rules (preview) are not used.

### 8. Diagnostics
- **Serilog** handles structured console logging, request logging and configuration-driven levels. The bootstrap
  logger is non-reloadable, so several hosts (test fixtures) can start in one process.
- **OpenTelemetry** traces and metrics: ASP.NET Core 11 emits `Microsoft.AspNetCore` activities natively, so only the
  source names are subscribed. Demo runs emit `DotNet11Lab` activities and a `dotnet11lab.demo.runs` counter. The
  console exporter is enabled with `Telemetry:ConsoleExporter=true`.

### 9. Persistence only where it adds value
SQLite + Dapper back a single feature: Lab 5's run journal, which keeps quick-measurement history across
sessions. Nothing else needs a database.

## Dependencies and why

| Package | Why it is needed |
|---|---|
| Microsoft.AspNetCore.OpenApi | OpenAPI 3.2 document generation (Lab 3) |
| Microsoft.AspNetCore.Components.QuickGrid | The QuickGrid features under demonstration (Lab 4) |
| Serilog.AspNetCore | Structured logging (required) |
| OpenTelemetry.* | Tracing/metrics export (required); ASP.NET Core instrumentation is native in 11 |
| Dapper, Microsoft.Data.Sqlite | Run journal (Lab 5) |
| Microsoft.Extensions.AI(.OpenAI) | AI abstraction and the OpenAI-compatible provider (Lab 9) |
| ModelContextProtocol | MCP server sample (Lab 9, experimental folder) |
| BenchmarkDotNet | Cross-runtime benchmarks (Lab 5) |
| xunit.v3.mtp-v2, Microsoft.AspNetCore.Mvc.Testing, bunit | Tests |
