# Lab 5 - Runtime Performance

Page: `/labs/performance` · Code: `src/DotNet11Lab.Core/Labs/Performance/`, `src/DotNet11Lab.Benchmarks/` ·
Methodology: [`BENCHMARKS.md`](../../BENCHMARKS.md)

## What's new

.NET 11 does not add a "performance feature" you switch on; the runtime itself changes. Microsoft's runtime notes
list, among others: JIT bounds-check elimination for `i + cns < len` and `values[^1]`, removal of redundant
checked contexts, folding of `x is 0 or 1 or ...` switches, devirtualization of generic virtual methods and
default interface methods, a single `MUL` for `Math.BigMul` on x64, `ExecutionContext` capture skipped for
continuations that have nothing to restore (all `Task`/`ValueTask` continuations), and a raised x86-64 baseline
(x86-64-v2). The lab does **not** assert any of these as speed-ups. It measures identical code on .NET 10.0 and
.NET 11.0 so you can see what changes for typical workloads.

## Why it matters

Upgrading the runtime is the cheapest performance work there is: no code change. Knowing which kinds of code
benefit (and which allocate the same either way) tells you where your own optimization effort still pays.

## What the lab shows

1. **Published BenchmarkDotNet results** (`results/benchmarks/latest.json`): per benchmark, mean time on .NET 10
   and .NET 11, the ratio, allocated bytes and the allocation ratio. If the file is missing the page says so and
   shows the command; it never shows made-up numbers. Preliminary files (smoke runs) are labelled.
2. **Live quick measurements** of the same workloads on the .NET 11 runtime that serves the page
   (`LivePerformanceRunner`, `Measure.Run`): duration, allocated bytes per operation, operations per second and
   speed relative to the slowest variant. Every variant's result (checksum) is shown so you can see they compute
   the same thing.
3. **Run journal**: each live run is stored in SQLite with Dapper (`PerformanceJournal`, default
   `<content root>/App_Data/perf-journal.db`, configurable with `PerformanceLab:JournalPath`), with a trend chart
   per workload across sessions.

## Example

```csharp
// Allocates a string[] plus one string per field before parsing.
foreach (var field in csv.Split(',')) sum += int.Parse(field, CultureInfo.InvariantCulture);

// Enumerates ranges over the original characters: no array, no substrings.
ReadOnlySpan<char> span = csv;
foreach (Range range in span.Split(',')) sum += int.Parse(span[range], CultureInfo.InvariantCulture);
```

## Previous approach

The "before" column of each pair is the code most of us wrote first: `string.Split`, `+=` in a loop,
`StreamReader.ReadLine` + `Split`, reflection-based `JsonSerializer`, `Task<T>` for cache hits, LINQ chains,
`Dictionary` for read-mostly lookups. All of it still works and is often fine.

## Performance implications

- Allocation differences are deterministic and visible even in quick live runs (e.g. the span parser allocates
  0 B per call, `string.Split` ~39 KB for 1,000 fields).
- Time differences need BenchmarkDotNet: many iterations, process isolation, warm-up, statistics.
- Build configuration changes results: a Debug build disables JIT optimizations and turns async state machines
  into heap-allocated classes (measured +48 B per synchronously completing `ValueTask` call). The page warns
  when the server runs Debug.

## Production use cases

- Validate a runtime upgrade with your own hot paths in a BenchmarkDotNet project that multi-targets the old and
  new TFM, as this lab does.
- Parsing logs/CSV/telemetry with spans or `PipeReader`; source-generated JSON for APIs and AOT; frozen
  collections for configuration and routing tables built once and read often.

## When not to use

- Do not micro-optimize code that a profiler has not shown to matter; LINQ and `Split` are clearer.
- `FrozenDictionary` costs more to build; avoid it for data that changes or is read a few times.
- Do not compare numbers across machines or from preliminary (short-job or busy-machine) runs.

## Official documentation

- What's new in the .NET 11 runtime: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/runtime
- What's new in .NET 11: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/overview
- Memory and spans: https://learn.microsoft.com/dotnet/standard/memory-and-spans/
- System.IO.Pipelines: https://learn.microsoft.com/dotnet/standard/io/pipelines
- System.Text.Json source generation: https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/source-generation
- Frozen collections: https://learn.microsoft.com/dotnet/api/system.collections.frozen
- BenchmarkDotNet: https://benchmarkdotnet.org/
