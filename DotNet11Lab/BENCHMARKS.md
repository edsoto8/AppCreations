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
- `Job.MediumRun` for full runs: 2 launches × (10 warm-up + 15 measured iterations). BenchmarkDotNet's adaptive
  `Job.Default` was tried first. On the shared 4-vCPU VM, timing noise drove almost every benchmark to the
  100-iteration cap, so the suite would have run past two hours without a better estimate. A fixed, standard
  budget is more honest than a run that never converges. Error and standard deviation are still reported.
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

Recorded on **2026-11-12** on an otherwise idle 4-vCPU cloud VM: Intel Xeon @ 2.10 GHz, Ubuntu 24.04.5,
SDK 11.0.100, runtimes .NET 10.0.15 and .NET 11.0.0, BenchmarkDotNet 0.15.8, `Job.MediumRun`. The complete tables are
[`results/benchmarks/latest.md`](results/benchmarks/latest.md) and [`results/publish/latest.md`](results/publish/latest.md),
and the dashboard (Labs 5 and 8) reads the matching `.json` files. Both are marked `"preliminary": false`.

### How to read the ratios

This VM is noisy: run-to-run standard deviation was **5–18% of the mean** for most benchmarks. A ratio is therefore
reported as *faster* or *slower* only when the difference is at least **2 combined standard deviations**
(`|mean − baseline mean| / √(sd² + sd_baseline²) ≥ 2`). Anything else is **within noise**, meaning no change was
detectable on this hardware. It does not mean "no change". Allocation figures are deterministic, so allocation
ratios do not carry this caveat.

### Runtime comparison (.NET 10 → .NET 11, same workload, same machine)

| Benchmark | .NET 10 | .NET 11 | Ratio | Verdict |
|---|---:|---:|---:|---|
| `ValueTask<int>` that completes asynchronously | 108.82 µs | 61.54 µs | **0.57** | **faster** (z ≈ 5.4) |
| JSON serialize, source-generated | 165.50 µs | 101.94 µs | **0.62** | **faster** (z ≈ 2.0) |
| JSON serialize, reflection | 235.57 µs | 168.11 µs | 0.71 | within noise (z ≈ 1.5), consistent with the above |
| JSON deserialize, source-generated | 414.61 µs | 370.76 µs | 0.89 | within noise |
| GZip optimal | 5.28 ms | 4.98 ms | 0.94 | within noise |
| All other cross-runtime benchmarks (16) | | | 0.95–1.07 | within noise |

No benchmark was detectably **slower** on .NET 11. Allocations were identical across runtimes for every benchmark
(allocation ratio 1.00), so the gains above come from faster code paths, not fewer allocations.

**What this does and doesn't show.** On this hardware, .NET 11 improves async `ValueTask` paths and JSON
serialization. Text parsing, streams, LINQ, dictionary lookups and Brotli/GZip did not change measurably. A quieter
or bare-metal machine may detect smaller differences. Re-run the suite on your own hardware before drawing
conclusions for your workload.

### Zstandard (.NET 11 only, same 115 KB payload as the Brotli/GZip benchmarks)

| Benchmark | Mean | Allocated |
|---|---:|---:|
| Zstandard fastest | 913.08 µs | 115.6 KB |
| Zstandard optimal | 1.55 ms | 115.6 KB |
| Brotli fastest / optimal (.NET 11) | 1.37 ms / 4.34 ms | 115.5 KB |
| GZip fastest / optimal (.NET 11) | 1.57 ms / 4.98 ms | 346.2 KB / 115.6 KB |

On this payload Zstandard compressed faster than both Brotli and GZip at the matching level. Compression *ratios*
are measured live in Lab 6, because they depend on the data.

### Runtime async vs classic state machines (.NET 11, depth-10 await chains)

| Workload | Classic | Runtime async | Time ratio | Verdict | Alloc (classic → runtime async) |
|---|---:|---:|---:|---|---|
| Chain completing synchronously | 146.4 ns | 71.9 ns | **0.49** | **faster** | 216 B → 72 B (0.33) |
| Chain with `Task.Yield` at the leaf | 2.75 µs | 2.33 µs | **0.85** | **faster** | 1.3 KB → 744 B (0.56) |
| Order pricing (mixed) | 44.10 µs | 36.10 µs | 0.82 | within noise | 2.2 KB → 1.4 KB (0.65) |

The two copies are compiled from identical source (a test enforces it); only the compilation mode differs.
Runtime async allocated less in every case. It remains **opt-in** for your code
(`<Features>runtime-async=on</Features>`). See Lab 7 for the compatibility considerations before enabling it.

### Publish modes (Lab 8: `dotnet11lab` CLI, linux-x64, 20 startup runs each)

| Mode | Deployed size | Startup (median wall-clock) | Peak working set | Dynamic code |
|---|---:|---:|---:|---|
| Framework-dependent | 0.1 MB (4 files) + shared .NET 11 runtime | 68.7 ms | 27.3 MB | yes |
| Self-contained single file | 73.9 MB | 65.4 ms | 26.1 MB | yes |
| **Native AOT** | **4.0 MB** | **4.4 ms** | **5.8 MB** | no |

For this CLI, Native AOT started about **15× faster**, used about **4.5× less memory** and was **18× smaller** than
the self-contained build. Framework-dependent is the smallest download but needs the runtime installed, and its
size excludes that runtime. `/usr/bin/time` was not available, so max RSS is not recorded; peak working set
comes from the CLI's own `--startup-probe`.
