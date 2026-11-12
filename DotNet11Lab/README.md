# DotNet 11 Lab

An interactive laboratory for **.NET 11, C# 15 and ASP.NET Core 11**. It is a Blazor dashboard of nine labs. Each
lab runs real code on the runtime serving the page, shows the source that ran (read from the compiled
assemblies), compares it with the .NET 10 / C# 14 approach, and measures the difference.

| # | Lab | What you can do |
|---|---|---|
| 1 | C# 15 language | Process payments with **union types**, step an order through a **closed** state machine, use **collection expression arguments**, **extension indexers** and **labeled `break`/`continue`** |
| 2 | LINQ joins | Reconcile bank vs ledger transactions (up to 200k rows or pasted CSV) with **`FullJoin`**; compare it with the old emulations |
| 3 | ASP.NET Core 11 | Send real requests from an **API playground**: async DataAnnotations validation, unions in JSON, ProblemDetails, **OpenAPI 3.2** vs 3.1 |
| 4 | Blazor 11 | Async-validated forms, **QuickGrid URL navigation** (interactive and static SSR), a 100k-row **Virtualize** list with jump-to-item, persistent state |
| 5 | Runtime performance | **BenchmarkDotNet results from .NET 10 and .NET 11**, live quick measurements and a SQLite run journal |
| 6 | Libraries | **Zstandard** vs Brotli/GZip (with trained dictionaries), the new **memory stream adapters**, **JSON Lines** output, System.Text.Json additions |
| 7 | Runtime Async | **Opt-in runtime-managed async**, isolated in one assembly and inspected by reflection, with results, stacks and allocations compared |
| 8 | Native AOT | A companion CLI published framework-dependent, self-contained and **Native AOT**, with measured size, startup and memory |
| 9 | AI | **Microsoft.Extensions.AI** with configurable providers, an offline mock that really calls tools, structured output and an **MCP** server |

Every feature carries a status: **Stable**, **Opt-in**, **Experimental** or **Baseline** (pre-.NET 11, for
comparison). See [FEATURE_MATRIX.md](FEATURE_MATRIX.md) for the evidence behind each status.

## Requirements

| | Needed for |
|---|---|
| [.NET SDK 11.0.100+](https://dotnet.microsoft.com/download/dotnet/11.0) | everything (pinned in `global.json`, roll-forward `latestFeature`) |
| .NET 10 runtime | the .NET 10 vs .NET 11 benchmarks only |
| Platform C toolchain | Native AOT publishing only: clang or gcc + zlib dev on Linux, Xcode command-line tools on macOS, Visual Studio "Desktop development with C++" on Windows |

No workloads are required (`dotnet workload list` can be empty). It runs on Windows, macOS and Linux, x64 and arm64.

## Quick start

```bash
cd DotNet11Lab
dotnet run --project src/DotNet11Lab.Web            # http://localhost:5180
```

The dashboard also hosts the Lab 3 API under `/api` and the OpenAPI documents at `/openapi/v1.json` (3.2) and
`/openapi/v1-3.1.json`. For representative numbers in the live measurement panels, run a Release build:

```bash
dotnet run -c Release --project src/DotNet11Lab.Web
```

## Running every demonstration

| Demonstration | Command |
|---|---|
| Dashboard (Labs 1–9) | `dotnet run --project src/DotNet11Lab.Web`, then use the sidebar |
| Lab 3 API alone | `dotnet run --project src/DotNet11Lab.Api` (http://localhost:5181, e.g. `curl localhost:5181/openapi/v1.json`) |
| Lab 4 static QuickGrid | open `/labs/blazor/quickgrid-static` (works with no interactive circuit) |
| Lab 5 benchmarks (.NET 10 vs 11) | `dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks` (writes `results/benchmarks/latest.json`, which the dashboard reads) |
| Lab 5 benchmark subset | `dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --filter "*Json*"`; `--list` shows the names; `--help` |
| Lab 8 CLI | `dotnet run --project src/DotNet11Lab.Cli -- gen 100000 --out tx.jsonl`, then `... -- stats tx.jsonl` |
| Lab 8 publish comparison | `./scripts/publish-compare.sh --runs 20` (Windows: `pwsh ./scripts/publish-compare.ps1 -Runs 20`); writes `results/publish/latest.json` |
| Lab 9 with a real model | see [AI providers](#ai-providers) |
| Lab 9 MCP server | `dotnet run --project experimental/DotNet11Lab.Mcp` (stdio server); `... -- --client-demo` runs a client against it |
| Telemetry to console | `dotnet run --project src/DotNet11Lab.Web -- --Telemetry:ConsoleExporter=true` |

## Tests

```bash
dotnet test --solution DotNet11Lab.slnx
```

The tests use xUnit v3 on **Microsoft.Testing.Platform** (selected in `global.json`). They cover every lab's logic,
the HTTP API (validation paths, union JSON, ProblemDetails, both OpenAPI versions), Blazor components (bUnit), the
CLI, the MCP server (started as a real process), and the integrity checks: every page renders, and every code
snippet a page shows exists in a compiled assembly.

## AI providers

The AI lab defaults to **Mock (offline, deterministic)**. To use a real model, configure it with environment
variables or user-secrets. Never put keys in `appsettings.json`.

```bash
cd src/DotNet11Lab.Web
dotnet user-secrets set "Ai:Provider" "OpenAI"            # OpenAI | AzureOpenAI | OpenAICompatible | Mock
dotnet user-secrets set "Ai:Model" "<model-name>"
dotnet user-secrets set "Ai:ApiKey" "<your key>"
# OpenAI-compatible servers such as Ollama:
#   Ai:Provider=OpenAICompatible  Ai:Endpoint=http://localhost:11434/v1  Ai:Model=<local model>
```

Environment-variable form: `Ai__Provider`, `Ai__Model`, `Ai__Endpoint`, `Ai__ApiKey`. The page shows which
provider is active and whether a key is set, as yes or no only. A misconfigured provider falls back to the mock.

## Experimental and platform limitations

- **Runtime Async** is opt-in and enabled only in `experimental/DotNet11Lab.RuntimeAsync` (`<Features>runtime-async=on</Features>`).
- **Blazor AI components** (`Microsoft.AspNetCore.Components.AI`) are a prerelease package. They are documented in Lab 9 but
  not referenced, because preview.7 pulls in RC-era dependencies with a known advisory (NU1902).
- **QuickGrid `AnchorMode`/`ItemComparer`** (ASP0030) and **C# 15 memory-safety rules** (preview) are not used.
- **BenchmarkDotNet 0.15.8** does not know .NET 11 yet. `src/DotNet11Lab.Benchmarks/Net11Toolchain.cs` adds a
  documented workaround; see [BENCHMARKS.md](BENCHMARKS.md).
- **Native AOT** cannot cross-compile between operating systems and needs the native toolchain listed above.
- `scripts/publish-compare.ps1` mirrors the bash script but was not run in this repository's Linux environment.

## Documentation

| Document | Contents |
|---|---|
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Every feature: status, whether it is new in 11, and how it was verified |
| [LEARNING_GUIDE.md](LEARNING_GUIDE.md) | Suggested path, key takeaways and exercises; links to `docs/labs/*` |
| [docs/labs/](docs/labs/) | Per-lab deep dives: what's new, why, example, previous approach, performance, use cases, links |
| [BENCHMARKS.md](BENCHMARKS.md) | Methodology and recorded results (runtime comparison, runtime async, publish modes) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Projects, dependency graph, key decisions, dependency justification |
| [SPEC.md](SPEC.md) | Requirements and acceptance criteria |
| [CLAUDE.md](CLAUDE.md) | Conventions for contributors (including AI agents) |
| [docs/research-notes.md](docs/research-notes.md) | Raw research notes with Microsoft Learn URLs |

## Project layout

```
src/DotNet11Lab.Core          lab logic (UI-free, tested)        src/DotNet11Lab.Web         Blazor dashboard (+ /api)
src/DotNet11Lab.Api           Minimal API (Lab 3)                src/DotNet11Lab.Benchmarks  BenchmarkDotNet, net10 + net11
src/DotNet11Lab.Cli           dotnet11lab CLI (Native AOT)       experimental/               runtime async, MCP server
tests/DotNet11Lab.Tests       xUnit v3 on MTP                    scripts/, results/          measurement scripts and output
```
