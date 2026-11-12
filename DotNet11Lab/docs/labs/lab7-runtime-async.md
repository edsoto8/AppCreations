# Lab 7 - Runtime Async (opt-in, isolated)

Page: `/labs/runtime-async` · Code: `src/DotNet11Lab.Core/Labs/RuntimeAsync/` (classic copy + inspector),
`experimental/DotNet11Lab.RuntimeAsync/` (runtime-async copy), `src/DotNet11Lab.Benchmarks/Suites/RuntimeAsyncBenchmarks.cs`

## What's new

.NET 11 ships "Runtime Async V2": instead of the C# compiler rewriting each `async` method into a generated
`IAsyncStateMachine` type, the compiler marks the method with `MethodImplAttributes.Async` and the runtime (JIT,
ReadyToRun, Native AOT) handles suspension and resumption. The .NET runtime libraries are compiled this way already.

Enable it per project for code that targets `net11.0`:

```xml
<PropertyGroup>
  <Features>$(Features);runtime-async=on</Features>
</PropertyGroup>
```

`EnablePreviewFeatures` is no longer needed. The `DOTNET_RuntimeAsync`/`UNSUPPORTED_RuntimeAsync` environment
variables were removed; `<UseRuntimeAsync>false</UseRuntimeAsync>` is the documented per-project opt-out.

**Status we verified (SDK 11.0.100):** your own code is **not** compiled with runtime async by default. Without the
`Features` flag, Roslyn emits the classic `[AsyncStateMachine]` attribute and a nested `<Method>d__N` type; setting
`UseRuntimeAsync` to true or false alone changed nothing. With the flag, methods carry `MethodImplAttributes.Async`
and no state machine type is generated. The docs page shows both an "enable" flag and an "opt-out" property, so its
default is ambiguous; this lab's reflection table is the evidence. In this solution only
`experimental/DotNet11Lab.RuntimeAsync` sets the flag (a test fails if any other project does).

## How the lab compares fairly

`AsyncChainWorkloads.cs` exists twice, textually identical except for the namespace line (enforced by a test and
shown live on the page from the embedded sources): once in DotNet11Lab.Core (classic) and once in the experimental
assembly (runtime async). The page:

1. reads by reflection, for every async method: implementation flags, `[AsyncStateMachine]`, generated state
   machine types and IL size (classic: 7 methods, 7 generated types; runtime async: 7 methods flagged `Async`,
   0 generated types in the whole assembly);
2. runs every workload through both copies and checks the results are identical;
3. captures stacks from a four-level chain `PlaceOrderAsync → ValidateOrderAsync → LoadCustomerAsync →
   QueryDatabaseAsync` in three situations and lists only differences the captured text supports;
4. times a deep await chain with `Measure.RunAsync` (quick, labelled as such) and shows the BenchmarkDotNet
   results of `RuntimeAsyncBenchmarks` (.NET 11 job, classic vs runtime async) when `results/benchmarks/latest.json`
   contains them.

## Debugging: what we observed (.NET 11.0.0, Release, thread-pool caller)

| Capture | Classic | Runtime async |
|---|---|---|
| `new StackTrace()` while the chain still runs synchronously | 25 frames; each chain method appears **twice** (stub, then the state machine's `MoveNext`, both shown under the method name) with `AsyncMethodBuilderCore.Start` between; 7 async-infrastructure frames | 17 frames; each chain method once; 3 infrastructure frames (from the classic caller outside the chain) |
| `new StackTrace()` after `Task.Yield` resumed the innermost method | 8 frames: `QueryDatabaseAsync` plus `AsyncStateMachineBox.ExecutionContextCallback`, `ExecutionContext.RunFromThreadPoolDispatchLoop`, `AsyncStateMachineBox.MoveNext` | 5 frames: `QueryDatabaseAsync` directly on the thread-pool dispatch loop |
| `ex.ToString()` of an exception thrown after resuming | 5 `at` lines naming the chain in order | identical shape, 5 `at` lines |

So the documented improvement in *live* stacks (fewer infrastructure frames, each method once) reproduces. Two
honest caveats: exception traces were already clean and look the same (as Microsoft's notes say), and after a real
suspension **neither** model has the suspended callers on the thread's stack - they are waiting, not running.
Exact counts depend on the caller (a Blazor circuit adds its synchronization context frames, so the page runs the
captures on the thread pool) and on the build.

## Performance implications

Microsoft lists dedicated JIT async versions, cached continuations, tail-merged suspension points, tiered async
compilation and `Task`/`ValueTask` factory intrinsics. Our quick and `--quick` BenchmarkDotNet runs on a busy
machine pointed the same way (fewer bytes allocated per chain), but they are preliminary; see `BENCHMARKS.md`
for the final run. Debug builds distort async measurements heavily (classic state machines become heap classes),
so compare Release builds only.

## Compatibility considerations

| Area | Status |
|---|---|
| Reflection over `[AsyncStateMachine]` / `<M>d__N` types | Finds nothing in runtime-async assemblies (verified). Tools, tests or serializers that rely on them break. |
| Results | Identical for all workloads here (verified). |
| Debugger | Docs: breakpoints bind and stepping over `await` works (not verified here). |
| Profilers / APM | Docs: the runtime's async profiler instruments both models. Third-party agents that rewrite IL or inspect state machines: unverified. |
| Native AOT, ReadyToRun | Docs: supported. Not exercised in this lab. |
| WebAssembly | Docs: incompatible; NuGet-shipped ASP.NET Core packages are not compiled with it for that reason. |
| Multi-targeting libraries | The feature applies to `net11.0` builds; enable it conditionally. |

## Production use cases

Services and apps that target only `net11.0` with deep async call chains, where better live stacks in profilers and
dumps help diagnosis, after measuring throughput and allocations on your own workload.

## When not to use

Libraries that also target older frameworks or WebAssembly; code or tooling that inspects compiler-generated state
machines; when your APM/profiler vendor has not confirmed support.

## Official documentation

- What's new in the .NET 11 runtime - Runtime Async: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/runtime#runtime-async
- What's new in .NET 11: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/overview
- Asynchronous programming with async and await: https://learn.microsoft.com/dotnet/csharp/asynchronous-programming/
- `MethodImplAttributes`: https://learn.microsoft.com/dotnet/api/system.reflection.methodimplattributes
- `AsyncStateMachineAttribute`: https://learn.microsoft.com/dotnet/api/system.runtime.compilerservices.asyncstatemachineattribute
