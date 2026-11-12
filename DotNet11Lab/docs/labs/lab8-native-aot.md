# Lab 8 - Native AOT & Publishing

Page: `/labs/native-aot` · Code: `src/DotNet11Lab.Cli/`, `scripts/publish-compare.sh`, `scripts/publish-compare.ps1`,
`src/DotNet11Lab.Core/Labs/NativeAot/` · Methodology: [`BENCHMARKS.md`](../../BENCHMARKS.md#2-publish-comparison-lab-8)

## What's new

Native AOT itself is not new in .NET 11 (it has been supported since .NET 7, ASP.NET Core since .NET 8). The .NET 11
notes list incremental changes: faster interface dispatch through a shared dispatch helper (smaller call sites),
runtime async supported under Native AOT, and on Unix the native *library* outputs now get a `lib` prefix
(opt out with `UseNativeLibPrefix=false`). Optimized publish (`UseOptimizedPublish`) is described as opt-in by the
SDK what's-new page while a breaking-change page still describes it as the default; this lab does not depend on it.

## Why it matters

The deployment mode decides what users must install, how big the download is, how fast the process starts and how
much memory it needs. For CLIs, serverless functions and scale-to-zero containers, startup and memory dominate.

## What the lab shows

- `dotnet11lab`, a small but real tool: `stats <file|->` summarises JSON Lines transactions per currency and
  category, `gen <count>` writes deterministic sample data, `compress`/`decompress` use the in-box .NET 11
  `ZstandardStream`, and `--startup-probe` prints one JSON line with process-start-to-`Main` time, working set, peak
  working set, GC heap, runtime, RID, `RuntimeFeature.IsDynamicCodeSupported` and the JIT-compiled method count.
- The scripts publish it framework-dependent, self-contained single-file and Native AOT, then measure size, startup
  (median wall-clock over N launches) and memory, and write `results/publish/latest.json`, which the page charts.
  If the file is missing the page shows the command instead of numbers.
- Live facts about the dashboard process itself (JIT, framework-dependent): uptime, working set, GC heap, number of
  JIT-compiled methods and JIT time, `IsDynamicCodeSupported`.

## Example

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>
  <AssemblyName>dotnet11lab</AssemblyName>
  <IsAotCompatible>true</IsAotCompatible>      <!-- trim/AOT analyzers on; warnings are errors in this repo -->
  <InvariantGlobalization>true</InvariantGlobalization>
</PropertyGroup>
```

```csharp
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(Transaction))]
public sealed partial class CliJsonContext : JsonSerializerContext;

var t = JsonSerializer.Deserialize(line, CliJsonContext.Default.Transaction); // no reflection at run time
```

```bash
dotnet publish src/DotNet11Lab.Cli -c Release -r linux-x64 -p:PublishAot=true
```

## Previous approach

Framework-dependent deployment (needs an installed runtime) or self-contained/single-file deployment (bundles the
runtime and still JIT-compiles at startup). Reflection-based `JsonSerializer.Deserialize<T>(json)` is the usual
serialization call; under trimming/AOT it produces IL2026/IL3050 warnings and may fail at run time.

## Performance implications

- Native AOT removes JIT work at startup and loads no IL, so startup time and working set drop; the validation run
  in this repository showed that clearly, but its numbers are preliminary (contended machine) and are not quoted
  here - see `results/publish/latest.md` after a run on a quiet machine.
- Steady-state throughput can be lower than JIT with tiered/dynamic PGO for long-running services: measure.
- Self-contained single file is large because the whole runtime ships, untrimmed, and startup is similar to
  framework-dependent because the code is still JIT-compiled.

## Platform restrictions

- No cross-OS compilation: build Linux binaries on Linux, Windows on Windows, macOS on macOS. Cross-architecture
  (x64 <-> arm64) on the same OS is possible with the right toolchain.
- Toolchain: `clang` (or gcc) and zlib development files on Linux; Xcode command line tools on macOS;
  Visual Studio 2022+ with "Desktop development with C++" on Windows.
- Native AOT implies trimming and single-file: no `Reflection.Emit`, no dynamic assembly loading, no built-in COM,
  limited reflection, interpreted `System.Linq.Expressions`. Libraries must be AOT-compatible.
- A Linux binary runs on the same or newer distribution version than it was built on.

## Production use cases

CLIs and developer tools, serverless functions, sidecars and small microservices in containers, scale-to-zero
workloads, environments where JIT is not allowed.

## When not to use

Apps that need plugins or runtime code generation, reflection-heavy frameworks without AOT support, long-running
throughput-bound services where JIT warm-up does not matter, or when one build must serve several operating systems.

## Official documentation

- Native AOT deployment: https://learn.microsoft.com/dotnet/core/deploying/native-aot/
- Native AOT cross-compilation: https://learn.microsoft.com/dotnet/core/deploying/native-aot/cross-compile
- .NET application publishing overview: https://learn.microsoft.com/dotnet/core/deploying/
- Single-file deployment: https://learn.microsoft.com/dotnet/core/deploying/single-file/overview
- Trimming incompatibilities: https://learn.microsoft.com/dotnet/core/deploying/trimming/incompatibilities
- System.Text.Json source generation: https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/source-generation
- What's new in the .NET 11 runtime: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/runtime
- Breaking change - full build skipped for Native AOT publish: https://learn.microsoft.com/dotnet/core/compatibility/sdk/11/aot-publish-skips-full-build
