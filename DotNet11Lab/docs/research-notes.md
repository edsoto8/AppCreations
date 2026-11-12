# .NET 11 / C# 15 / ASP.NET Core 11 / Blazor 11 — verified research notes

Researched 2026-11-12. Sources: Microsoft Learn (fetched via Learn MCP). Learn "What's new" pages state they were
"last updated for the general availability (GA) release". devblogs.microsoft.com was NOT reachable from this
session (host blocked by network policy), so nothing below is sourced from the announcement blog post.
"UNCONFIRMED" = no official source found/confirmed it.

Key URLs
- Overview: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/overview
- Runtime: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/runtime
- Libraries: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/libraries
- SDK: https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/sdk
- C# 15: https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-15
- Unions ref: https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/union
- ASP.NET Core 11: https://learn.microsoft.com/aspnet/core/release-notes/aspnetcore-11
- Breaking changes: https://learn.microsoft.com/dotnet/core/compatibility/11
- Release type (STS vs LTS), GA date: UNCONFIRMED (not stated on fetched pages).

---------------------------------------------------------------------------------------------------
## 1. C# 15

Default language version for `net11.0` projects in the .NET 11 SDK. Per the C# 15 page: "Except for memory
safety, these features don't require `<LangVersion>preview</LangVersion>`." i.e. all below are STABLE except
Memory safety (PREVIEW).

Feature list (official, csharp-15 page):
1. Collection expression arguments — stable
2. Union types — stable
3. Closed hierarchies (`closed` modifier) — stable
4. Extension indexers — stable
5. Labeled `break` and `continue` — stable (CONFIRMED it IS in C# 15)
6. Non-virtual static interface members on older runtimes — stable
7. Memory safety — PREVIEW (LangVersion preview + `updated-memory-safety-rules` feature flag)

### 1.1 Collection expression arguments `with(...)`
`with(...)` must be the FIRST element; args go to the collection's constructor or factory method.
```csharp
List<string> names = [with(capacity: values.Length * 2), .. values];
HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"]; // 1 element
```
Also usable in collection initializers (see Object and Collection Initializers doc).
Spec: https://learn.microsoft.com/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments

### 1.2 Union types
Declaration: `public union Pet(Cat, Dog, Bird);`
- Case types: any type convertible to `object` (classes, structs, interfaces, type params, nullable types, other unions).
  e.g. `public union IntOrString(int, string);`, `public union Option<T>(None, Some<T>);`
- Compiler lowers `union` to a **struct** marked `[System.Runtime.CompilerServices.Union]` implementing
  `System.Runtime.CompilerServices.IUnion`, with one public ctor per case type and a `Value` property (`object?`).
  Value-type cases are BOXED (stored as single `object?`).
- Body allowed (like a struct) but NO instance fields, auto-properties, or field-like events; no public
  single-parameter ctors (generated); any ctor must chain via `this(...)` to a generated ctor.
- Implicit "union conversion" from each case type (calls generated ctor). User-defined implicit operator wins.
  Ambiguous when two case types equally applicable -> compile error.
- Works with nullable union struct: `Pet? maybePet = new Dog(...)`.
- Pattern matching: type/declaration patterns test the CONTENTS (`Value`), not the union. Untyped property
  pattern `{ Name: "Rex" }` uses union's own members. `var`/`_` capture the union itself. `pet is Pet` -> error CS8121.
  `pet is not null` = has-a-value test; `{ }` always matches non-nullable struct union.
- Exhaustiveness: switch handling every case type needs no `_` arm. Default union has null `Value`; if all case
  types are non-nullable, compiler may NOT warn about missing `null` arm but switch throws
  `SwitchExpressionException` at runtime on `default`. Prefer explicit `null` arm (not `_`) to keep new-case warnings.
  Nullable case type (e.g. `union NullablePet(Cat?, Dog, Bird)`) -> warning CS8655 if `null` arm missing.
```csharp
string name = pet switch { Dog d => d.Name, Cat c => c.Name, Bird b => b.Name, null => "no pet" };
```
- Custom unions ("basic union pattern"): any class/struct with `[Union]`, public single-param ctors (each defines a
  case type), public `object?` `Value { get; }`. Optional non-boxing access pattern: `bool HasValue` +
  `bool TryGetValue(out T)` per case. Optional "union member provider": nested public `IUnionMembers` interface with
  static `Create(...)` methods + `Value`. Class-based unions allowed (`null` pattern matches null ref OR null Value).
- Runtime types `UnionAttribute` and `IUnion` ship in .NET 11 (System.Runtime.CompilerServices).
  Libraries page: "They aren't directly user-facing yet—the C# compiler and source generators are the expected producers."
- Spec: https://learn.microsoft.com/dotnet/csharp/language-reference/proposals/csharp-15.0/unions
- JSON serialization of unions: see §3.3. ASP.NET Core support: see §5.

### 1.3 Closed hierarchies
```csharp
public closed record class GateState;
public record class Closed : GateState;
public record class Open(float Percent) : GateState;
string Describe(GateState s) => s switch { Closed => "closed", Open(var p) => $"{p}% open" }; // exhaustive, no default
```
- `closed` is a contextual keyword on classes; closed class can only be derived from within its declaring assembly.
- Implicitly `abstract`; can't combine with `sealed`, `static`, or explicit `abstract`.
- NOT transitive: a non-closed descendant can be derived elsewhere; mark intermediates `closed` to extend exhaustiveness.
- Docs: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/closed ;
  patterns#closed-hierarchy-patterns ; spec proposals/csharp-15.0/closed-hierarchies
- STJ can infer polymorphism from closed hierarchies (§3.3).

### 1.4 Extension indexers (extension members addition)
C# 14 introduced `extension(...)` blocks; C# 15 adds indexers in them. Requires a NAMED receiver parameter.
```csharp
public static class SequenceIndexer
{
    extension(IEnumerable<int> sequence)
    {
        public int this[int index] => sequence.ElementAt(index);
    }
}
int third = Enumerable.Range(1, 10)[2];
```
Doc: https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/extension#extension-indexers
Other new extension member kinds in C# 15: UNCONFIRMED (only indexers listed).

### 1.5 Labeled break / continue — CONFIRMED in C# 15 (stable)
```csharp
outer: for (int row = 0; row < grid.Height; row++)
{
    for (int column = 0; column < grid.Width; column++)
    {
        if (grid[row, column].IsBlocked) continue outer;
        if (grid[row, column].IsGoal) break outer;
    }
}
```
Label goes directly on the loop or `switch` statement. Unlabeled break/continue unchanged.
Style rule IDE0410 flags bool-flag/goto patterns replaceable by labeled jumps.
Spec: proposals/csharp-15.0/labeled-break-continue ; ref: language-reference/statements/jump-statements

### 1.6 Non-virtual static interface members on older runtimes
Non-virtual static interface members (e.g. `public static double ToMeters(double cm) => cm / 100;`) can be declared
and used even when the target runtime doesn't support default interface implementations. Instance DIMs,
`static abstract`/`static virtual`, protected members still need runtime support.

### 1.7 Memory safety — PREVIEW
- Enable syntax + pointer relaxations: `<LangVersion>preview</LangVersion>`; updated rules: compiler feature
  `updated-memory-safety-rules` (see language-reference/compiler-options/language#enable-the-updated-memory-safety-rules).
- With preview: declaring pointer types, `&` address-of, `fixed`, `stackalloc`->pointer, `sizeof` no longer need
  `unsafe`. Dereference (`*p`, `p->m`, `p[i]`), function pointer invocation still need `unsafe`.
- New `unsafe(expression)` expression (needs preview + `AllowUnsafeBlocks`); `safe` contextual keyword;
  `unsafe` on a member = "requires-unsafe" (caller obligation) under updated rules;
  `System.Runtime.CompilerServices.MemorySafetyRulesAttribute` records use.
- Breaking changes doc: https://learn.microsoft.com/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2011

---------------------------------------------------------------------------------------------------
## 2. LINQ

Source: libraries page "LINQ join improvements". Available on `Enumerable`, `Queryable`, AND `AsyncEnumerable`.
- NEW in .NET 11: `FullJoin` (all elements of both sequences, `default` on the side with no match).
- NEW in .NET 11: tuple-returning `Join` and `GroupJoin` overloads (no result selector), optional
  `IEqualityComparer<TKey>`; optional-comparer overload also on FullJoin/LeftJoin/RightJoin.
- NOTE: `LeftJoin` / `RightJoin` were introduced in **.NET 10** (Learn "Join operations in LINQ" + EF Core 10
  what's-new say ".NET 10 includes LeftJoin and RightJoin"). The .NET 11 page discusses them alongside FullJoin;
  only FullJoin + tuple overloads are new in 11.
Tuple-returning signature as listed in API ref (view=net-11.0):
```csharp
public static IEnumerable<(TOuter Outer, TInner? Inner)> LeftJoin<TOuter,TInner,TKey>(
    this IEnumerable<TOuter> outer, IEnumerable<TInner> inner,
    Func<TOuter,TKey> outerKeySelector, Func<TInner,TKey> innerKeySelector,
    IEqualityComparer<TKey>? comparer = default);
```
Usage:
```csharp
foreach (var (product, category) in products.LeftJoin(categories, p => p.Category, c => c.Name)) ...
var fullJoined = products.FullJoin(categories, p => p.Category, c => c.Name);
var result = products.Join(orders, p => p.Id, o => o.ProductId);   // tuples, no selector
```
Exact FullJoin tuple element nullability (e.g. `(TOuter? Outer, TInner? Inner)`): UNCONFIRMED (signature not fetched).
API: https://learn.microsoft.com/dotnet/api/system.linq.enumerable.fulljoin
Other new LINQ methods in .NET 11: none found (UNCONFIRMED beyond the above).

---------------------------------------------------------------------------------------------------
## 3. Libraries

### 3.1 Zstandard
- Types: `System.IO.Compression.ZstandardStream`, `ZstandardEncoder`, `ZstandardDecoder` (decoder implied by
  "Zstandard primitives"), `ZstandardDictionary`, `ZstandardCompressionOptions` (seen in ASP.NET sample).
- Libraries page: "The Zstandard compression APIs ... are now part of the System.IO.Compression namespace, alongside
  DeflateStream, GZipStream, and BrotliStream. The API surface is otherwise unchanged." (wording implies they moved
  from a separate location during previews; exact prior namespace/package UNCONFIRMED.)
- Dictionary training:
```csharp
byte[] data = ZstandardDictionary.Train(samples, sampleLengths, maxDictionarySize: 4096);
using ZstandardDictionary dictionary = ZstandardDictionary.Create(data, quality: 19);
```
- Also: span-based `DeflateEncoder/Decoder`, `ZLibEncoder/Decoder`, `GZipEncoder/Decoder` (Brotli-shaped
  `Compress(source, dest, out consumed, out written, isFinalBlock)` -> `OperationStatus`) + `Reset()`.
- ZIP: `ZipArchiveEntry.Open(FileAccess)`/`OpenAsync(FileAccess, ct)`, `CompressionMethod` property
  (`ZipCompressionMethod` Stored/Deflate/Deflate64), CRC32 validation (throws `InvalidDataException`),
  password support `Open(ReadOnlySpan<char>)` + `ZipEncryptionMethod`.
- Breaking: DeflateStream/GZipStream now always write header/footer even for empty payload.
- Tar: `TarFile.CreateFromDirectory(..., format: TarEntryFormat.Gnu)`; GNU sparse 1.0 read.
- ASP.NET Core zstd response compression / request decompression enabled by default (§5).

### 3.2 In-memory stream adapters (namespace System.IO)
- `ReadOnlyMemoryStream` — `ReadOnlyMemory<byte>` as read-only stream
- `WritableMemoryStream` — writable `Memory<byte>` as fixed-size stream
- `ReadOnlySequenceStream` — `ReadOnlySequence<byte>` without flattening (Pipelines)
- `StringStream` — `string` or `ReadOnlyMemory<char>` read as stream using an encoding
```csharp
using Stream config = new StringStream(yamlText, Encoding.UTF8);
using Stream body = new ReadOnlyMemoryStream(payload);
```

### 3.3 System.Text.Json
- **C# union serialization**: writes the active case directly (no wrapper, no `$type`). `"hello"` / `42` /
  default union -> `null`. Deserialization picks case by JSON token kind. For multiple object cases use:
```csharp
[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]
public union PetUnion(Dog, Cat);
```
  Structural classifier uses root-level property names + required properties; throws `JsonException` on 0 or >1
  match. Custom: derive `JsonTypeClassifierFactory` -> `JsonTypeClassifier` delegate; register via
  `JsonUnionAttribute.TypeClassifier`, `JsonSerializerOptions.TypeClassifiers`, or
  `JsonSourceGenerationOptionsAttribute.TypeClassifiers`. Metadata: `JsonTypeInfoKind.Union`, `JsonUnionCaseInfo`.
  Doc: https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/union-types
- **F# DUs**: fieldless case -> `"Point"`; with fields -> `{"$type":"Circle","radius":3.14}`. Reflection only
  (no source gen / trimming / Native AOT).
- **JSON Lines (output)**: four new `JsonSerializer.SerializeAsyncEnumerable` overloads (Stream or PipeWriter;
  options or `JsonTypeInfo<T>`). `topLevelValues: true` -> JSONL (compact value + `\n` incl. final; ignores
  NewLine/WriteIndented). Default `false` -> single JSON array. Streams entries without buffering.
```csharp
await JsonSerializer.SerializeAsyncEnumerable(pipeWriter, GenerateNumbers(), topLevelValues: true);
```
  (Reading JSONL via `DeserializeAsyncEnumerable(..., topLevelValues: true)` predates .NET 11 — .NET 9; not new.)
- **Closed hierarchy polymorphism inference**: `[JsonPolymorphic(InferClosedTypePolymorphism = true)]`,
  `JsonSerializerOptions.InferClosedTypePolymorphism`, `JsonSourceGenerationOptionsAttribute.InferClosedTypePolymorphism`.
  Explicit `[JsonDerivedType]` replaces inferred list. Open generic `[JsonDerivedType(typeof(Derived<>), "derived")]`.
- `JsonNamingPolicy.PascalCase` / `JsonKnownNamingPolicy.PascalCase`; `[JsonNamingPolicy]` attribute on type/member.
- Type-level `[JsonIgnore(Condition=...)]` on classes/structs/interfaces (Always invalid at type level; SYSLIB1226).
- Generic `JsonSerializerOptions.GetTypeInfo<T>()` / `TryGetTypeInfo<T>(out JsonTypeInfo<T>?)`.
- Source gen: `[JsonInclude]` on private/internal/protected members; inaccessible `[JsonConstructor]`; init-only
  defaults retained; ctor params with in/ref/out/ref readonly.
- Built-in converters: BFloat16, Decimal32/64/128; open generic `[JsonConverter(typeof(OptionConverter<>))]`;
  `IReadOnlyDictionary` extension data; `JsonObject` extension data; `IReadOnlySet<T>` support.
- `Utf8JsonWriter.Reset(Stream|IBufferWriter<byte>, JsonWriterOptions)` for reuse.

### 3.4 Other notable library APIs
- Async DataAnnotations: `AsyncValidationAttribute` (override `IsValidAsync(object?, ValidationContext, CancellationToken)`
  returning `Task<ValidationResult?>`; sync `IsValid` still abstract — throw from it), `IAsyncValidatableObject`
  (`IAsyncEnumerable<ValidationResult> ValidateAsync(ValidationContext, CancellationToken)`; extends
  `IValidatableObject`), `Validator.ValidateObjectAsync / TryValidateObjectAsync / ValidatePropertyAsync /
  ValidateValueAsync`. `ValidationAttribute.FormatMessage(template, name)`.
- Options: `IAsyncValidateOptions<T>.ValidateAsync`, `IAsyncStartupValidator`; `IStartupValidator` now OBSOLETE.
- Process: run-and-capture helpers, fire-and-forget, `ProcessStartInfo.StartSuspended`,
  `Process.TryGetProcessById(int, out Process)`, `Process.Signal(PosixSignal)`, `ProcessExitStatus`.
- Numerics: `Decimal32/Decimal64/Decimal128` (IEEE 754 decimal), `Complex<T>`, `INumberBase<T>.TryParsePartial`,
  `Random.NextInteger<T>` / `NextBinaryFloat<T>`, BFloat16 in BitConverter.
- `EqualityComparer<T>.Create(keySelector)`; `BitArray` span ctors + `PopCount`.
- Vector lane APIs: `Vector128.CreateGeometricSequence`, `Zip/Unzip`, `Concat*`, `Reverse` (all vector widths).
- Crypto: `X25519DiffieHellman`; `Aes.EncryptKeyWrap/DecryptKeyWrap`; EXPERIMENTAL `CompositeMLKem` (SYSLIB5006),
  `Hpke` (SYSLIB5009). Networking: `DnsResolver` typed DNS records; EXPERIMENTAL `TlsContext/TlsSession/
  TlsBufferSession/TlsSocketSession` (SYSLIB5007); `QuicStream.Priority`; `MediaTypeNames.Video`.
- `Console` honors `FORCE_COLOR`. Regex `AnyNewLine` option. `CborReader` incremental reading.
- MemoryCache built-in OTel metrics; Activity tracing config via rules in Microsoft.Extensions.Diagnostics.

---------------------------------------------------------------------------------------------------
## 4. Runtime

### 4.1 Runtime Async ("Runtime Async V2")
- No longer requires `<EnablePreviewFeatures>true</EnablePreviewFeatures>` for `net11.0`.
- Runtime page: "To enable Runtime Async in a project that targets net11.0, add":
```xml
<PropertyGroup><Features>runtime-async=on</Features></PropertyGroup>
```
- Same page note: "The DOTNET_RuntimeAsync and UNSUPPORTED_RuntimeAsync environment variables ... have been removed.
  To opt out of runtime-async per project, set `<UseRuntimeAsync>false</UseRuntimeAsync>`."
  -> DOCS AMBIGUITY: page says both "add Features to enable" and "UseRuntimeAsync=false to opt out". Whether user
  code compiled for net11.0 gets runtime-async BY DEFAULT is UNCONFIRMED. Safe guidance: set
  `<Features>runtime-async=on</Features>` explicitly to guarantee it.
- .NET runtime libraries AND ASP.NET Core shared-framework-only libraries are compiled with runtime-async=on
  (apps benefit automatically when calling them). ASP.NET packages that also ship standalone on NuGet are excluded
  because "runtime-async is incompatible with WebAssembly".
- Supports NativeAOT and ReadyToRun; crossgen2 inlining restrictions removed; covariant Task->Task<T> override thunks.
- Debugging: breakpoints bind inside runtime-async methods; stepping over `await` without compiler infra.
  Live stack traces (`new StackTrace()`, profilers, debugger) show real call chain (example: 13 -> 5 frames).
  Exception stack traces look the same either way.
- Perf: dedicated JIT async versions, tail-merged suspension points, cached continuations, tiered async compilation,
  Task/ValueTask factory intrinsics, tail-await, ExecutionContext capture skipped when nothing to restore (applies to
  all Task/ValueTask continuations, not just runtime-async).
- Async profiler instruments both runtime-async and state-machine methods.

### 4.2 JIT / codegen / GC / VM
- Min hardware raised: x86/x64 baseline x86-64-v1 -> **x86-64-v2** (all OSes); Windows Arm64 requires LSE.
  R2R target x86-64-v3 on Windows/Linux. Old CPUs fail: "The current CPU is missing one or more of the baseline
  instruction sets."
- JIT: bounds-check elimination (`i + cns < len`, `values[^1]`, after `!span.IsEmpty`), redundant checked-context
  removal, switch/`is 0 or 1 or ...` folding, constant-folding `string.Equals`/`SequenceEqual` on constants,
  generic virtual method + DIM devirtualization, `Activator.CreateInstance<T>()` exact type, redundant branch
  elimination, `Math.BigMul` single MUL on x64, saturating float->small-int conversions, SVE2 intrinsics,
  `AvxVnni.V512`, hardware FP16 for `Half`.
- R2R: `Comparer<T>.Default`/`EqualityComparer<T>.Default` specialized (up to 20x).
- GC: Windows multi-CPU-group GC fix; >1024 CPUs supported (GC keeps 1024-heap limit). No other GC features found
  (UNCONFIRMED).
- In-process crash report: `DOTNET_EnableCrashReport=1` / `DOTNET_EnableCrashReportOnly=1` (Linux/macOS/mobile).
- `Guid.NewGuid()` on Linux uses getrandom() (~12% faster).
- CoreCLR on WebAssembly runs libraries test suite end to end (WebCIL V1 default for CoreCLR WASM builds).
- iOS/tvOS: advisory file locking disabled by default (`DOTNET_SYSTEM_IO_DISABLEFILELOCKING=0` to restore).
- MAUI: CoreCLR default runtime for iOS/Mac Catalyst/macOS (from Preview 7); Android NativeAOT experimental.

---------------------------------------------------------------------------------------------------
## 5. ASP.NET Core 11
(Page header still says "This article will be updated as new preview releases are made available.")

### 5.1 Async validation (Minimal APIs)
- `Microsoft.Extensions.Validation` runs `AsyncValidationAttribute` and `IAsyncValidatableObject` end-to-end.
  Register: `builder.Services.AddValidation();` then `app.MapPost("/reservations", (ReservationRequest r) => ...)`.
- Async attributes on same member start together; collection items validated in parallel.
- `[ValidatableType]` and `[SkipValidation]` NO LONGER experimental (drop `ASP0029` suppressions).
- Validation localization built in: `AddLocalization()` + `AddValidation()`; keys
  `{DeclaringType}_{MemberName}_{AttributeType}_Error` etc.; `ValidationOptions.LocalizerProvider`;
  `IValidationMessageFormatter.FormatMessage(CultureInfo, string template, string displayName)`.
- Endpoint filters now run even when parameter binding fails (status 400 observable).
- `[ShortCircuit]` / `[ShortCircuit(404)]` attribute (MVC + Minimal APIs).

### 5.2 OpenAPI
- Microsoft.AspNetCore.OpenApi supports OpenAPI 3.2.0 via `Microsoft.OpenApi` 3.3.1 (BREAKING changes from that lib).
- **OpenAPI 3.2 is the DEFAULT** document version. Select version:
```csharp
builder.Services.AddOpenApi(o => o.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_1); // or OpenApi3_2
```
- SSE: `TypedResults.ServerSentEvents(IAsyncEnumerable<SseItem<T>>)` described with 3.2 `itemSchema`.
- HTTP QUERY in documents; binary file responses (`FileContentResult` -> string/binary); file stream results;
  multiple `Produces`/`[ProducesResponseType]` per status code preserved; obsolete APIs reflected;
  build-time doc generation can select an environment.

### 5.3 Union types
- Supported anywhere System.Text.Json is used: Minimal API/MVC JSON bodies (request + response), SignalR
  `JsonHubProtocol`, Blazor JS interop, persistent component state, prerendered component parameters.
```csharp
public union UnionIntString(int, string);
app.MapGet("/value", () => new UnionIntString(42));
```
- NOT supported for route values, query strings, headers, form fields. SignalR MessagePack/Newtonsoft protocols: no.
- OpenAPI: union -> `anyOf` of case components (no discriminator); detected via `JsonTypeInfoKind.Union`.
- (Doc inconsistency: SSE section calls DUs "a preview C# 14 feature" — contradicted by C# 15 page; unions are C# 15 stable.)

### 5.4 Error handling / ProblemDetails
- No ProblemDetails / exception-handler changes listed in What's new for ASP.NET Core 11 — UNCONFIRMED / none found.
- Related: Kestrel HTTP/1.1 parser no longer throws `BadHttpRequestException` per malformed request (perf).

### 5.5 Other ASP.NET Core
- Zstandard response compression + request decompression, enabled by default;
  `ZstandardCompressionProviderOptions { CompressionOptions = new ZstandardCompressionOptions { Quality = 6 } }`.
- Native OTel tracing: subscribe to `Microsoft.AspNetCore` activity source; no OpenTelemetry.Instrumentation.AspNetCore needed.
  Opt-out switch `Microsoft.AspNetCore.Hosting.SuppressActivityOpenTelemetryData`.
- `mcpserver` template bundled in SDK: `dotnet new mcpserver -o MyMcpServer`.
- Antiforgery auto-injected; `app.UseAntiforgery()` removed from Blazor Web App template.
- `IAuthorizationRequirementData` now works on SignalR hubs, MVC, AuthorizeView/AuthorizeRouteView.
- SignalR auth refresh; cancel hub invocations from client. Identity `TimeProvider`. Experimental Device Bound
  Session Credentials. `IOutputCachePolicyProvider`. Dev-cert auto-trust in WSL.

---------------------------------------------------------------------------------------------------
## 6. Blazor 11

### 6.1 Async form validation
- `EditForm` submit awaits async validators in ANY render mode. `DataAnnotationsValidator` runs
  `AsyncValidationAttribute` / `IAsyncValidatableObject` automatically.
- APIs: `ValidationRequestedEventArgs.AddAsyncValidator` (whole form), `EditContext.RegisterAsyncFieldValidator(
  FieldIdentifier, Func<CancellationToken, Task>)` (single field), `EditContext.IsValidationPending(field)`,
  `EditContext.IsValidationFaulted(field)`. Framework owns CTS and cancels superseded validations.
- Static SSR forms get client-side validation by default when `DataAnnotationsValidator` present.
- Doc: https://learn.microsoft.com/aspnet/core/blazor/forms/validation-advanced?view=aspnetcore-11.0#asynchronous-validation

### 6.2 QuickGrid
- URL-based navigation (DEFAULT): paging/sort state in query string (`page`, `sort`=column Title, `direction`=asc|desc);
  headers/paginator render as `<a href>`; works in static SSR. Disable rendering of anchors with
  `AppContext.SetSwitch("Microsoft.AspNetCore.Components.QuickGrid.EnableUrlBasedQuickGridNavigationAndSorting", false)`.
- `QueryParameterNameOptions` parameter (`Sort`, `Direction`, `Page`; ctor prefix e.g. `new QueryParameterNameOptions("products_")`).
  BREAKING: multiple grids on one page now need unique names; each needs its own `PaginationState`.
  CSS breaking change (`a.col-title`, `nav a[aria-disabled="true"]`). Renaming a column Title breaks bookmarked URLs.
- `OnRowClick` parameter (`EventCallback<TGridItem>`), `row-clickable` CSS class.
- When `Virtualize="true"`: `InitialItemIndex`, `ScrollToItemAsync(int)`, and EXPERIMENTAL (diagnostic `ASP0030`)
  `AnchorMode`, `ItemComparer` — all forward to inner Virtualize.

### 6.3 Virtualize
- Variable item heights measured at runtime; native CSS scroll anchoring with ResizeObserver fallback (tables/Safari).
- `OverscanCount` default changed 3 -> 15.
- `AnchorMode` parameter: `None`, `Start` (default), `End` (chat/log). (On QuickGrid it's flagged experimental ASP0030;
  experimental status on Virtualize itself not stated — UNCONFIRMED.)
- `InitialItemIndex` parameter; `ScrollToItemAsync(int itemIndex, CancellationToken cancellationToken = default)`
  (throws InvalidOperationException before first interactive render; last call wins; clamps index).
- CSP compliant: heights via `data-blazor-virtualize-reserved-height` attributes instead of inline style.

### 6.4 Render modes / client config / state persistence
- No new render modes found (UNCONFIRMED). `WithBrowserOptions(...)` on `MapRazorComponents<App>()` configures
  client startup from C# across Server/WebAssembly/Auto (reconnection, log level, WASM env vars/culture).
- Client-side prerendering persists server `CurrentCulture/CurrentUICulture`; opt out with
  `AddInteractiveWebAssemblyComponents(o => o.UseCultureFromServer = false)`.
- Static SSR state: `ITempData` cascading parameter + `[SupplyParameterFromTempData]`;
  session: `[SupplyParameterFromSession]` (needs `AddSession`/`UseSession`). Streaming-SSR session cookie fix.
- Persistent component state: unions supported; no other persistence API changes found (UNCONFIRMED).
- `CacheView` component (static SSR output caching: `VaryByQuery`, `ExpiresAfter`).
- Circuits: server-triggered pause `Circuit.RequestCircuitPauseAsync(CancellationToken)`; auto-pause on hidden tab
  via package `Microsoft.AspNetCore.Components.Server.AutoPause` +
  `.WithBrowserOptions(o => o.AddAutoPause(p => p.HiddenDelay = TimeSpan.FromSeconds(30)))` (default 2 min);
  circuits receive refreshed auth without reconnect.
- New components: `DisplayName`, `BasePath`, `EnvironmentView`; `NavigateTo`/`NavLink` `RelativeToCurrentUri`;
  `GetUriWithFragment`; MathML namespace; `IComponentPropertyActivator`; `IHostedService` in WASM;
  `blazorwebworker` template (renamed); `blazor-wasm-servicedefaults` template;
  `Microsoft.AspNetCore.Components.Gateway` replaces `...WebAssembly.DevServer`.

### 6.5 Experimental Blazor AI components
- Package: `Microsoft.AspNetCore.Components.AI` (+ `AGUI.Client` for AG-UI remote agents; brings `AGUI.Abstractions`).
- Status (doc): "a prerelease, experimental package throughout .NET 11 ... might not ship in a stable version."
- Components/APIs: `ChatPage` (`Agent`, `Placeholder`, `WelcomeContent`, `MessageListContent`), `AgentBoundary`,
  `MessageList`, `MessageInput`, `UIAgent` / `UIAgent<TState>` (over any `IChatClient`), `BlockRenderer<TBlock>`
  (`When` predicate), blocks: `RichContentBlock`, `FunctionInvocationContentBlock`, `UIActionBlock`,
  `FunctionApprovalBlock` (`Approve`/`Reject`), `ActivityContentBlock`; `[ToolBlock]`/`[ToolParameter]`/`[ToolResult]`
  source gen + `options.AddGeneratedToolBlocks()`; `options.RegisterUIAction(AIFunction)`; `IConversationThread`,
  `RestoreAsync`; stylesheet `_content/Microsoft.AspNetCore.Components.AI/ai-chat.css`.
- Doc: https://learn.microsoft.com/aspnet/core/blazor/components/ai-components?view=aspnetcore-11.0

---------------------------------------------------------------------------------------------------
## 7. AI

### 7.1 Microsoft.Extensions.AI
- Packages: `Microsoft.Extensions.AI.Abstractions` (IChatClient, IEmbeddingGenerator; for provider libraries) and
  `Microsoft.Extensions.AI` (middleware: function invocation, OTel, caching; for apps). `IImageGenerator` is EXPERIMENTAL.
- Versions seen in Learn API browser (view=net-11.0-pp): `Microsoft.Extensions.AI` v11.0.0,
  `Microsoft.Extensions.AI.OpenAI` v11.0.0; `Microsoft.Extensions.AI.Abstractions` shown inconsistently (v10.6.0 / v10.11.0)
  on different pages. Exact current stable version: UNCONFIRMED — check nuget.org.
- Release notes for extensions live at https://github.com/dotnet/extensions/releases (not fetched).
- Doc: https://learn.microsoft.com/dotnet/ai/microsoft-extensions-ai

### 7.2 MCP C# SDK
- Package `ModelContextProtocol` (`dotnet add package ModelContextProtocol`); maintained by Microsoft, Anthropic and the
  MCP org; depends on Microsoft.Extensions.AI. Repo: https://github.com/modelcontextprotocol/csharp-sdk
- Version / stable-vs-preview status: UNCONFIRMED from Learn (Learn quickstart still says the
  `Microsoft.McpServer.ProjectTemplates` package is "currently in preview" — but in .NET 11 the `mcpserver` template is
  BUNDLED in the SDK per ASP.NET Core 11 notes).
- Doc: https://learn.microsoft.com/dotnet/ai/get-started-mcp

---------------------------------------------------------------------------------------------------
## 8. Native AOT in .NET 11
- Faster interface dispatch via shared dispatch helper (smaller call sites); GVM dispatch uses dispatch cells;
  `Assembly.GetCallingAssembly()` works when stack trace data available.
- Runtime Async supported under NativeAOT.
- Optimized publish: SDK what's-new (GA) says `UseOptimizedPublish` defaults to **false** (opt-in):
```xml
<PublishAot>true</PublishAot><UseOptimizedPublish>true</UseOptimizedPublish>
```
  CONFLICT: breaking-change page "Full build skipped for Native AOT publish" still says .NET 11 skips the full
  Build target by default (BeforeBuild/AfterBuild etc. don't run). GA what's-new indicates this became opt-in.
  https://learn.microsoft.com/dotnet/core/compatibility/sdk/11/aot-publish-skips-full-build
- Breaking: NativeAOT native library outputs on Unix get `lib` prefix (`libmylib.so`); opt out `<UseNativeLibPrefix>false</UseNativeLibPrefix>`.
- Breaking: non-blittable `[UnmanagedCallersOnly]` signatures throw `InvalidProgramException` (fail fast) when runtime marshalling enabled.
- WASM NativeAOT publish keeps package satellite assemblies. Android NativeAOT experimental.
- dotnet CLI itself: NativeAOT entry point ON by default (`DOTNET_CLI_ENABLEAOT=false` to opt out); file-based apps
  reuse AOT build outputs.
- F# DU JSON support is not AOT-compatible; C# union JSON works with source gen.

---------------------------------------------------------------------------------------------------
## 9. xUnit v3 + Microsoft.Testing.Platform (MTP) with .NET 11 SDK
- Enable MTP mode of `dotnet test` (available since .NET 10 SDK) in global.json:
```json
{ "test": { "runner": "Microsoft.Testing.Platform" } }
```
  Default runner is still VSTest if nothing set. New in .NET 11: env var `DOTNET_TEST_RUNNER=Microsoft.Testing.Platform`
  (or `VSTest`, case-insensitive) overrides global.json. Requires MTP >= 1.7.
- In MTP mode use `--project`, `--solution`, `--test-modules` instead of positional paths; `--` optional.
- xUnit: "MTP is supported starting with xunit.v3." Opt-in property:
  `<UseMicrosoftTestingPlatformRunner>true</UseMicrosoftTestingPlatformRunner>` (+ `<OutputType>Exe</OutputType>` per
  migration doc). xUnit docs: https://xunit.net/docs/getting-started/v3/microsoft-testing-platform
- Template: `dotnet new xunit --xunit-version v3` -> xUnit v3 project defaulting to MTP; `--test-runner VSTest` to opt out.
  (So the bare `dotnet new xunit` default version is UNCONFIRMED — presumably still v2 unless `--xunit-version v3`.)
- Package names: `xunit.v3` (core). Specific runner package names (e.g. xunit.runner.visualstudio, xunit.v3.mtp-v2)
  UNCONFIRMED from Microsoft docs — check xunit.net.
- Coverage: `Microsoft.Testing.Extensions.CodeCoverage` + `dotnet test --coverage`.
- .NET 11 `dotnet test` (MTP) additions: `--no-dependencies`, `--use-current-runtime`, `--timeout 90s` (exit 3),
  `--maximum-failed-tests N` (exit 13), `--results-directory-layout per-module`, `--test-modules` `!` excludes,
  traversal projects, live in-flight display, experimental affected tests (`DOTNET_CLI_ENABLE_AFFECTED_TESTS=1`,
  `--collect-test-map`, `--affected-tests`), `--artifacts-path`.
- Docs: https://learn.microsoft.com/dotnet/core/tools/dotnet-test ;
  https://learn.microsoft.com/dotnet/core/testing/migrating-vstest-microsoft-testing-platform

---------------------------------------------------------------------------------------------------
## 10. SDK misc (for completeness)
- File-based apps: `#:include helpers.cs`, `#:include ./libs/MyLibrary.dll`, quoted `#:property`, item metadata
  (`#:package System.CommandLine@2.0.1 Aliases=CommandLine`); `dotnet format app.cs`; `dotnet reference add --file app.cs`.
- `dotnet run -e KEY=VALUE`; `dotnet sln` edits `.slnf`; `dotnet watch` Aspire integration, crash recovery, `--device`.
- MSBuild server on by default (`DOTNET_CLI_USE_MSBUILD_SERVER=false` to opt out).
- `dotnet nuget add source ... --min-publish-age-hours 24`.
- Container publish: Podman multi-arch, prefers `wslc`/`container`, reproducible via `SOURCE_DATE_EPOCH`.
