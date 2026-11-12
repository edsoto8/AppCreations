# Feature Matrix — DotNet 11 Lab

Every feature below was checked two ways before any code was written:

- **Compiler / reflection**: compiled against the installed **.NET SDK 11.0.100** (runtime 11.0.0,
  C# 15 default language version) or found by reflecting over the shipped reference assemblies
  (`packs/Microsoft.NETCore.App.Ref/11.0.0`, `packs/Microsoft.AspNetCore.App.Ref/11.0.0`).
- **Docs**: confirmed on Microsoft Learn (pages marked "updated for GA"). Raw notes with every URL:
  [`docs/research-notes.md`](docs/research-notes.md).

Status legend: **Stable** = GA, no opt-in. **Opt-in** = GA but must be enabled. **Experimental** = preview
package, `[Experimental]` diagnostic or feature flag; isolated from the stable app.

"New in 11?" means the API or syntax does not exist in .NET 10 / C# 14. Where it says **No**, the lab
uses it as a baseline for comparison only.

## C# 15 — Lab 1

| Feature | Status | New in 11? | Verified | Notes | Docs |
|---|---|---|---|---|---|
| Union types `union Pet(Cat, Dog);` | Stable | Yes | Compiler (CS9327 under LangVersion 14) | Lowered to a `struct` with `[Union]`, implements `System.Runtime.CompilerServices.IUnion` (`object? Value`). Value-type cases are boxed. `default` holds `null`. Patterns test the *contained value*. `switch` over all cases is exhaustive without `_`. | [union](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/union) |
| Closed hierarchies `closed record Shape;` | Stable | Yes | Compiler | A closed type is implicitly abstract (`closed abstract` is error CS9384). Derived types must be in the same assembly, so `switch` is exhaustive. | [closed](https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/closed) |
| Collection expression arguments `[with(capacity: 32), ..xs]` | Stable | Yes | Compiler | Passes ctor / builder arguments, e.g. capacity or comparer. | [spec](https://learn.microsoft.com/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments) |
| Extension indexers (`this[...]` inside `extension(T t) { }`) | Stable | Yes | Compiler | Only considered when the receiver has **no applicable instance indexer**: `"abc"[2L]` binds to `string`'s `int` indexer and fails. | [extension indexers](https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/extension#extension-indexers) |
| Labeled `break outer;` / `continue outer;` | Stable | Yes | Compiler ("labeled break and continue") | IDE0410 analyzer suggests it. | [C# 15](https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-15) |
| Memory safety rules | Experimental | Yes | Docs only | `LangVersion=preview` + feature flag. **Not used in this app.** | [C# 15](https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-15) |

## LINQ — Lab 2

| Feature | Status | New in 11? | Verified | Notes |
|---|---|---|---|---|
| `Enumerable.FullJoin` (tuple + result-selector overloads) | Stable | Yes | Reflection | Also on `Queryable` and `AsyncEnumerable` (incl. async key selectors with `CancellationToken`). |
| Tuple-returning `Join` / `GroupJoin` (no result selector) | Stable | Yes | Docs | |
| `LeftJoin` / `RightJoin` | Stable | **No (.NET 10)** | Reflection + docs | Used as the comparison baseline. |

Docs: [Enumerable.FullJoin](https://learn.microsoft.com/dotnet/api/system.linq.enumerable.fulljoin),
[.NET 11 libraries](https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/libraries)

## Libraries — Lab 6

| Feature | Status | New in 11? | Verified | Notes |
|---|---|---|---|---|
| `System.IO.Compression.ZstandardStream`, `ZstandardEncoder`/`Decoder`, `ZstandardDictionary` (`Train`), `ZstandardCompressionOptions` | Stable | Yes | Reflection | In-box, no NuGet package. Also `System.Net.Http.ZstandardCompressedContent`. |
| `System.IO.ReadOnlyMemoryStream`, `WritableMemoryStream`, `StringStream`; `System.Buffers.ReadOnlySequenceStream` | Stable | Yes | Reflection | Stream views over memory with no copy. |
| JSON Lines **writing**: `JsonSerializer.SerializeAsyncEnumerable(stream, items, topLevelValues: true, ...)` | Stable | Yes | Reflection | Reading (`DeserializeAsyncEnumerable(..., topLevelValues: true)`) existed since .NET 9. |
| C# union (de)serialization, `[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]` | Stable | Yes | Compiler + runtime | Writes the active case with no discriminator. Two object cases with overlapping shapes throw `JsonException` (verified). |
| `InferClosedTypePolymorphism`, `JsonNamingPolicy.PascalCase`, `GetTypeInfo<T>()` | Stable | Yes | Docs | |
| `EqualityComparer<T>.Create(keySelector)` | Stable | Yes | Docs | |

## ASP.NET Core 11 — Lab 3

| Feature | Status | New in 11? | Verified | Notes |
|---|---|---|---|---|
| `AsyncValidationAttribute` (`IsValidAsync`), `IAsyncValidatableObject`, `Validator.ValidateObjectAsync` | Stable | Yes | Reflection | Lives in `System.ComponentModel.Annotations`. Minimal APIs run them via `AddValidation()`. |
| OpenAPI 3.2 documents (now the default); `OpenApiOptions.OpenApiVersion` | Stable | Yes | Docs + runtime | Package `Microsoft.AspNetCore.OpenApi` 11.0.0. |
| Unions in JSON request/response bodies; OpenAPI `anyOf` | Stable | Yes | Docs + runtime | Not supported for route, query, header or form binding. |
| Zstandard response compression (`ZstandardCompressionProvider`) | Stable | Yes | Reflection | |
| ProblemDetails / error handling | Stable | **No changes in 11** | Docs | The lab uses existing `AddProblemDetails` + `ValidationProblem`. |

## Blazor 11 — Lab 4

| Feature | Status | New in 11? | Notes |
|---|---|---|---|
| Async form validation (`DataAnnotationsValidator` runs async validators, `EditContext.IsValidationPending`) | Stable | Yes | |
| QuickGrid URL-based paging/sorting (default), `QueryParameterNameOptions`, `OnRowClick` | Stable | Yes | Package `Microsoft.AspNetCore.Components.QuickGrid` 11.0.0 |
| QuickGrid / Virtualize `InitialItemIndex`, `ScrollToItemAsync(int)` | Stable | Yes | |
| QuickGrid `AnchorMode`, `ItemComparer` | **Experimental** (ASP0030) | Yes | Not used in the stable app. |
| Virtualize variable heights, `OverscanCount` default 3 → 15 | Stable | Yes | |
| `Microsoft.AspNetCore.Components.AI` (ChatPage, UIAgent, ...) | **Experimental** prerelease package (`11.0.0-preview.7`) | Yes | Documented only; not referenced by stable projects (see Lab 9). |

## Runtime — Labs 5 and 7

| Feature | Status | Verified | Notes |
|---|---|---|---|
| **Runtime Async** | **Opt-in** for your code; on in the framework libraries | Compiler + reflection | `<Features>runtime-async=on</Features>` makes Roslyn emit methods flagged `MethodImplAttributes.Async` **with no state-machine type**. With no flag, `UseRuntimeAsync=true` or `false`, the classic `IAsyncStateMachine` is emitted. `EnablePreviewFeatures` is not needed. The Learn page contradicts itself on the default, and our build is the evidence. Enabled **only** in `experimental/DotNet11Lab.RuntimeAsync`. |
| JIT / GC improvements | Stable | Measured, not asserted | Lab 5 runs equal workloads on .NET 10.0.15 and .NET 11.0.0 using BenchmarkDotNet. |

## Native AOT — Lab 8

| Feature | Status | Notes |
|---|---|---|
| Native AOT publish (`PublishAot=true`) | Stable | Needs clang + zlib on Linux (found). Optimized publish (`UseOptimizedPublish`) is opt-in; the docs disagree, so the lab measures. Unix native library outputs now get a `lib` prefix. |

## AI — Lab 9

| Feature | Status | Notes |
|---|---|---|
| `Microsoft.Extensions.AI` (`IChatClient`, `ChatClientBuilder`, function invocation) | Stable 11.0.0 | |
| `Microsoft.Extensions.AI.OpenAI` | Stable 11.0.0 | Works with any OpenAI-compatible endpoint, including Ollama `/v1`. |
| `ModelContextProtocol` C# SDK | Stable 2.4.0 (NuGet) | The `mcpserver` template ships in SDK 11. |
| Blazor AI components | Experimental | See Blazor table. |

## Tooling

| Item | Version used | Notes |
|---|---|---|
| .NET SDK | 11.0.100 | Pinned in `global.json`. |
| xUnit v3 | `xunit.v3` 4.0.3 | Runs on **Microsoft.Testing.Platform** (`global.json` `"test": {"runner": "Microsoft.Testing.Platform"}`). |
| BenchmarkDotNet | 0.15.8 | |
| Serilog.AspNetCore | 10.0.0 | |
| OpenTelemetry | 1.21.0 | ASP.NET Core 11 emits activities natively. |
| Dapper / Microsoft.Data.Sqlite | 2.1.89 / 11.0.0 | |

## Behaviour discovered while building the labs

Each item was confirmed by a compiler error, a test or a recorded run on .NET 11.0.0. The lab docs hold the details.

| Area | Finding | Evidence |
|---|---|---|
| C# 15 unions | A `switch` with no `null` arm compiles without a warning and throws `SwitchExpressionException` for `default`. | Lab 1 test |
| Collection arguments | `Dictionary<,> d = [with(comparer), ...]` → CS9215. `HashSet`, `SortedSet` and `ImmutableHashSet` accept `with(comparer)`. | Compiler |
| Extension indexers | `List<int>["x"]` binds to an extension indexer; `"abc"[2L]` does not compile. | Compiler |
| LINQ | `FullJoin` tuples are `(Outer, Inner)`, both nullable. Tuple `GroupJoin` returns `IGrouping<TOuter, TInner>`, not tuples. | Compiler + tests |
| Streams | `WritableMemoryStream.Length` starts at full capacity, and a write that doesn't fit throws `NotSupportedException`. `StringStream`/`ReadOnlySequenceStream` are not seekable, and `StringStream` writes no BOM. | Lab 6 tests |
| STJ | `EqualityComparer<T>.Create(keySelector)` takes a nullable input (`d => d?.Id`). | Compiler |
| Minimal API validation | On a type implementing `IAsyncValidatableObject`, only `ValidateAsync` runs; the inherited sync `Validate` does not. | Lab 3 test |
| Minimal API unions | In Development (`ThrowOnBadRequest`), a union body matching no case throws. Otherwise it returns a 400 `ValidationProblem`. | Lab 3 test |
| OpenAPI | SSE item schemas: 3.2 writes `itemSchema`, 3.1 writes `x-oai-itemSchema`. Unions appear as `anyOf` without a discriminator in both. | Lab 3 test |
| Blazor forms | Parameterless `EditContext.IsValidationPending()` stays false while a field-level async check is pending. Use the per-field overload. | Lab 4 bUnit test |
| Blazor Virtualize | Analyzer BL0011 requires `ItemComparer` when `Virtualize` uses `ItemsProvider`. | Compiler |
| Runtime async | Exception stack traces were identical in both compilation modes. Live stacks were shorter with runtime async (each method listed once). | Lab 7 recorded run |
| BenchmarkDotNet 0.15.8 | No `CoreRuntime.Core11_0` (CS0117). `CreateForNewVersion` hits `NotImplementedException`. Worked around in `Net11Toolchain.cs`. | Compiler + run |
| Debug builds | Async methods allocate extra in Debug (e.g. +48 B for a synchronously completing `ValueTask` call), so live numbers need `-c Release`. | Lab 5 run |
| MEAI | `McpClientTool` derives from `AIFunction`. `FailoverChatClient`/`ReducingChatClient` are `[Experimental]` (MEAI001) and not used. | Compiler |
| Blazor AI preview.7 | Depends on .NET 11 RC packages with advisory NU1902, so it is not referenced. | Restore |
| `dotnet new mcpserver` | Ships in SDK 11.0.100 but pins ModelContextProtocol 2.1.0; this repo uses 2.4.0. | Template |
