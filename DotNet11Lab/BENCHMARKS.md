# Benchmarks - methodology and results

This file covers the two measurement pipelines behind Lab 5 (Runtime Performance), Lab 7 (Runtime Async) and
Lab 8 (Native AOT & Publishing). The dashboard reads their output files; it never shows numbers that are not in
those files.

| Pipeline | Tool | Output read by the dashboard |
|---|---|---|
| Runtime comparison (.NET 10 vs .NET 11), runtime async vs classic | BenchmarkDotNet 0.15.8, `src/DotNet11Lab.Benchmarks` | `results/benchmarks/latest.json` (+ `latest.md`) |
| Publish modes (framework-dependent, self-contained, Native AOT) | `scripts/publish-compare.sh` / `.ps1` | `results/publish/latest.json` (+ `latest.md`) |

## 1. BenchmarkDotNet suites

### What is measured

The workloads live in `src/DotNet11Lab.Core/Labs/Performance/Workloads/*.cs`. The benchmarks project does not
reference Core; it **links** those files (`<Compile Include=... Link=...>`), so the dashboard's live panel and
BenchmarkDotNet execute exactly the same source, compiled for `net10.0` and `net11.0`.

| Category | Class | Benchmarks | Runtimes |
|---|---|---|---|
| Text | `TextBenchmarks` | `string.Split` vs span `Split` + ranges (1,000 integers); `+=` vs `StringBuilder` (300 lines) | .NET 10, .NET 11 |
| Streams | `StreamBenchmarks` | `StreamReader.ReadLineAsync` + `Split` vs `PipeReader` + `SequenceReader<byte>` + `Utf8Parser` (10,000-line ledger) | .NET 10, .NET 11 |
| Json | `JsonBenchmarks` | Reflection vs source-generated `System.Text.Json`, serialize and deserialize 200 orders | .NET 10, .NET 11 |
| Async | `AsyncBenchmarks` | 10,000 calls completing synchronously: plain method vs `async Task<int>` vs `async ValueTask<int>` | .NET 10, .NET 11 |
| Collections | `CollectionBenchmarks` | LINQ `Where/Select/Sum` vs loop (100,000 ints); `Dictionary` vs `FrozenDictionary` (10,000 lookups, 1,000 keys) | .NET 10, .NET 11 |
| Compression | `CompressionBenchmarks` | GZip and Brotli, `Optimal` and `Fastest`, ~250 KB of text | .NET 10, .NET 11 |
| Compression | `ZstandardBenchmarks` | Zstandard `Optimal`/`Fastest` (in-box only from .NET 11, `#if NET11_0_OR_GREATER`) | .NET 11 only |
| RuntimeAsync | `RuntimeAsyncBenchmarks` | The same source compiled classic vs `runtime-async=on`: async chain (depth 10) completing synchronously, chain yielding at the leaf, pricing 1,000 orders | .NET 11 only |

All inputs are generated from fixed seeds (`WorkloadData`), so every run sees identical data.

### Configuration

`src/DotNet11Lab.Benchmarks/LabBenchmarkConfig.cs`:

- One job per runtime: `.NET 10` (`CoreRuntime.Core10_0`, **baseline**) and `.NET 11`. BenchmarkDotNet builds
  and runs a separate child process per job, so each runtime uses its own JIT and GC.
- `[MemoryDiagnoser]` equivalent (`MemoryDiagnoser.Default`): allocated bytes per operation and Gen0 collections.
- Exporters: BenchmarkDotNet full JSON and GitHub markdown in `artifacts/benchmarks/results/`, plus the compact
  `results/benchmarks/latest.json` written by `SummaryConverter` (BenchmarkDotNet's full JSON has no field for the
  job's runtime or the benchmark categories, so the compact file is built from the in-memory summaries).
- Default job (`Job.Default`) for full runs: BenchmarkDotNet chooses launch, warm-up and iteration counts.
- `--quick`: `Job.ShortRun` with 1 warm-up and 3 iterations. For checking the pipeline only; such files are
  marked `"preliminary": true` and the dashboard says so.
- **Ratio** = mean time on .NET 11 / mean time on .NET 10 for the same benchmark (below 1.00 is faster), the same
  definition as BenchmarkDotNet's Ratio column. For `RuntimeAsyncBenchmarks` each `*_RuntimeAsync` method is
  divided by its `*_Classic` twin on the same runtime.

#### BenchmarkDotNet 0.15.8 and .NET 11 (verified workarounds)

- `CoreRuntime.Core11_0` does not exist (compile error CS0117), nor any `RuntimeMoniker` for .NET 11 (the enum
  ends at `Net10_0`). The .NET 11 job uses `CoreRuntime.CreateForNewVersion("net11.0", ".NET 11.0")`.
- Such a runtime has the moniker `NotRecognized`, and two code paths then throw
  `NotImplementedException: GetRuntimeVersion not implemented for NotRecognized`:
  1. the csproj toolchain's SDK validator - `Net11Toolchain` wraps `CsProjCoreToolchain` for `net11.0` and skips
     only that validator (the .NET 11 SDK is pinned by `global.json` anyway);
  2. the parallel-build partitioning in `BenchmarkRunnerClean` - avoided with `ConfigOptions.DisableParallelBuild`
     (decompiled check: the parallel-build predicate short-circuits on that option).
- Remove both workarounds once a BenchmarkDotNet release knows .NET 11.

### How to reproduce

Requirements: .NET SDK 11.0.100 (pinned in `global.json`) and the .NET 10 runtime (10.0.x) installed side by side.
Run from `DotNet11Lab/` on a quiet machine (no other builds, browsers or VMs busy; on a laptop, plugged in with
a fixed power plan).

```bash
# Full suite: every benchmark on .NET 10 and .NET 11, then results/benchmarks/latest.json and latest.md
dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks

# A subset (BenchmarkDotNet glob on Namespace.Type.Method)
dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --filter '*Json*' '*Streams*'

# List the benchmarks and the runtimes each one runs on
dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --list

# Pipeline smoke test (results marked preliminary)
dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --quick --filter '*TextBenchmarks*'
```

Other options: `--preliminary` (mark a full run as preliminary, e.g. on a busy machine), `--note <text>`,
`--results <path>`, `--no-results`. Any other argument goes to BenchmarkDotNet unchanged. A filtered run
overwrites `latest.json` with only the benchmarks it ran.

### Live measurements are not benchmarks

The Lab 5 "live quick measurements" panel runs the same workloads in the web server with
`Core/Diagnostics/Measure.cs`: a warm-up, then N timed iterations, allocations from the GC counters. No process
isolation, no statistics, one runtime, and other requests share the CPU. They are useful for the *shape* of a
difference (allocations especially), not for numbers to quote.

**Build configuration matters.** `dotnet run` builds Debug by default. In Debug, JIT optimizations are disabled
and Roslyn emits async state machines as **classes**, so every async call allocates: we measured
+48 B per `async ValueTask<int>` call that completes synchronously (480,305 B vs 72 B per 10,000-call operation,
the latter matching BenchmarkDotNet's MemoryDiagnoser). The dashboard detects a Debug build of the workload
assembly (`DebuggableAttribute.IsJITOptimizerDisabled`), shows a warning, and stores the build in the run journal.
For representative live numbers run `dotnet run -c Release --project src/DotNet11Lab.Web`.

## 2. Publish comparison (Lab 8)

`scripts/publish-compare.sh` (Linux/macOS, bash) and `scripts/publish-compare.ps1` (Windows, PowerShell 7) publish
`src/DotNet11Lab.Cli` (`dotnet11lab`) for the current RID, Release, into `artifacts/publish/<mode>`:

| Mode | Command |
|---|---|
| framework-dependent | `dotnet publish src/DotNet11Lab.Cli/DotNet11Lab.Cli.csproj -c Release -r <rid> --self-contained false -p:PublishSingleFile=false` |
| self-contained | `... --self-contained true -p:PublishSingleFile=true` (single file, **untrimmed**: the common "one file to copy" alternative) |
| native-aot | `... -p:PublishAot=true` |

Measurements per mode:

- **Deployed size**: total of the published files, excluding symbol files (`*.pdb`, `*.dbg`, `*.dSYM`), plus the
  executable alone. The framework-dependent size excludes the shared runtime it needs on the machine.
- **Startup**: 2 discarded warm-up launches, then N (default 10) launches of `dotnet11lab --startup-probe`, each
  timed from just before launch to exit with bash's `$EPOCHREALTIME` (microsecond resolution; PowerShell uses
  `Stopwatch`). Median, min and max are recorded. The probe also reports "process start to `Main`" from the OS
  process start time, which is coarse (clock ticks, ~10 ms on Linux) and shown as secondary.
- **Memory**: the probe's peak working set (`Process.PeakWorkingSet64`, median of the runs); additionally max RSS
  from `/usr/bin/time -v` (GNU) or `-l` (BSD/macOS) when that tool exists.
- **Dynamic code**: the probe's `RuntimeFeature.IsDynamicCodeSupported` (false under Native AOT).

```bash
./scripts/publish-compare.sh --runs 20                     # all three modes
./scripts/publish-compare.sh --modes fd,aot --runs 20      # a subset
pwsh ./scripts/publish-compare.ps1 -Runs 20                 # Windows
```

Native AOT needs the platform toolchain: `clang` (or gcc) and zlib development files on Linux, the Xcode command
line tools on macOS, Visual Studio 2022+ with "Desktop development with C++" on Windows. There is no cross-OS
Native AOT compilation.

## 3. Results

> **Pending final run.** The files committed under `results/` come from validation runs in a shared, contended
> 4-core container (other agents were building at the same time) and are marked `"preliminary": true`; the
> benchmark file used the `--quick` job and a subset of benchmarks. They prove the pipelines work end to end and
> must not be quoted. The final numbers will be produced on a quiet machine with the commands above and
> summarised here.

### Runtime comparison (.NET 10 vs .NET 11)

_Pending final run - see `results/benchmarks/latest.md` once produced._

### Runtime async vs classic state machines (.NET 11)

_Pending final run._

### Publish modes

_Pending final run - see `results/publish/latest.md` once produced._
