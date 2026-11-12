# Learning Guide — DotNet 11 Lab

This guide is a route through the lab. Each section links to a detailed write-up in [`docs/labs/`](docs/labs/)
that covers, for every feature: **what's new, why it matters, an example, the previous approach,
performance implications, production use cases, when not to use it, and the official Microsoft
documentation**. Every statement in these docs was checked against the installed .NET 11.0.0 / SDK 11.0.100
by compiling or running it. Where Microsoft Learn and the shipped bits disagreed, the docs follow the shipped
behaviour and say so.

Start the dashboard (`dotnet run --project src/DotNet11Lab.Web`) and open each lab as you read.

## Suggested path

| Step | Lab | Time | You will be able to... |
|---|---|---|---|
| 1 | [C# 15](docs/labs/lab1-csharp15.md) | 30 min | model closed sets of outcomes with `union` and `closed`, and pick the right one |
| 2 | [LINQ joins](docs/labs/lab2-linq.md) | 20 min | reconcile two datasets with `FullJoin` instead of the GroupJoin/anti-join workaround |
| 3 | [Libraries](docs/labs/lab6-libraries.md) | 25 min | choose between Zstandard, Brotli and GZip with data; stream JSON Lines; avoid buffer copies |
| 4 | [ASP.NET Core 11](docs/labs/lab3-aspnetcore.md) | 30 min | validate requests asynchronously, return unions from APIs, read an OpenAPI 3.2 document |
| 5 | [Blazor 11](docs/labs/lab4-blazor.md) | 30 min | build async-validated forms and navigable grids and lists over 100k rows |
| 6 | [Runtime performance](docs/labs/lab5-performance.md) | 20 min | read BenchmarkDotNet results across runtimes, and tell a quick measurement from a benchmark |
| 7 | [Runtime Async](docs/labs/lab7-runtime-async.md) | 20 min | explain how runtime-managed async differs from compiler state machines, and decide whether to opt in |
| 8 | [Native AOT](docs/labs/lab8-native-aot.md) | 20 min | choose a deployment mode from measured size, startup and memory |
| 9 | [AI](docs/labs/lab9-ai.md) | 30 min | build provider-agnostic AI features with `IChatClient`, tools and MCP |

## Key takeaways by lab

### 1. C# 15 — model closed sets in the type system
- `union Payment(Approved, Declined, Pending);` declares a value type that holds exactly one of its cases. A
  `switch` over the cases is exhaustive without a `_` arm, so adding a case is a compile-time to-do list rather than
  a runtime surprise.
- Unions are structs (`IUnion.Value` is `object?`; value-type cases are boxed). `default` holds `null`, and a
  `switch` without a `null` arm compiles but throws `SwitchExpressionException` on it. Treat `default` deliberately.
- `closed record OrderState;` is the class-hierarchy counterpart: derived types live in the same assembly, so
  switches over them are exhaustive. Choose `closed` when cases share behaviour or data, and `union` when they are
  unrelated types.
- `[with(capacity: n), ..items]` passes constructor arguments to collection expressions. It works for comparers on
  `HashSet`/`SortedSet` but not `Dictionary` (CS9215).
- Extension indexers and labeled `break`/`continue` remove boilerplate (`GetLine(sku)` helpers, flag variables).

### 2. LINQ — `FullJoin` for reconciliation
- `FullJoin` (new in 11) returns every element from both sides, with `default` on the side that has no match. That
  is exactly what reconciliation needs: matched, missing on the left, missing on the right. `LeftJoin`/`RightJoin`
  arrived in .NET 10.
- Duplicate keys multiply rows, just as in SQL. The lab's tests pin that behaviour.
- In the lab's measurements `FullJoin` allocated the least but was not always the fastest. Prefer it for
  clarity, and measure if the join sits on a hot path.

### 3. Libraries — data-driven choices
- Zstandard is in the box (`System.IO.Compression.ZstandardStream`, `ZstandardEncoder`, trained
  `ZstandardDictionary`). Dictionaries matter most for many small, similar payloads.
- `ReadOnlyMemoryStream`, `WritableMemoryStream`, `StringStream` and `ReadOnlySequenceStream` wrap existing
  memory without copying. Read their semantics: `WritableMemoryStream` has a fixed capacity and its `Length` starts
  at that capacity.
- `SerializeAsyncEnumerable(..., topLevelValues: true)` writes JSON Lines while items stream in.

### 4. ASP.NET Core 11 — validation that can await
- `AsyncValidationAttribute` and `IAsyncValidatableObject` run in Minimal APIs through `AddValidation()`. The lab
  compares this with hand-written sequential checks on the same simulated 35 ms lookups.
- When a type implements `IAsyncValidatableObject`, Minimal APIs call only `ValidateAsync`, not the inherited sync
  `Validate`.
- OpenAPI 3.2 is the default document version. Unions appear as `anyOf` with no discriminator.
- Unions work in JSON bodies only, not in route, query, header or form binding.

### 5. Blazor 11 — interactive data at scale
- `EditForm` + `DataAnnotationsValidator` await async validators. Ask about pending state **per field**
  (`IsValidationPending(field)`); the parameterless overload does not report field-level checks.
- QuickGrid stores paging and sorting in the URL by default, so it works on a static SSR page with no circuit. Two
  grids on one page need distinct `QueryParameterNameOptions`.
- `Virtualize` gains `ScrollToItemAsync` and `InitialItemIndex`. The lab drives a 100,000-row list with search and
  "jump to row" navigation.

### 6. Runtime performance — measure, don't assume
- The dashboard separates **quick measurements** (in-process, current runtime) from **BenchmarkDotNet results**
  (separate processes on .NET 10 and .NET 11, statistically analysed). See [BENCHMARKS.md](BENCHMARKS.md).
- Debug builds distort allocation numbers (async methods allocate more). Run the dashboard with `-c Release` when
  you care about the numbers; the pages warn you otherwise.

### 7. Runtime Async — opt-in, per assembly
- `<Features>runtime-async=on</Features>` makes Roslyn emit async methods marked `MethodImplAttributes.Async`
  with no generated state machine. The runtime manages suspension instead.
- Your own code does not get it by default. The lab's experimental assembly is the only one that opts in, and a test
  keeps its source identical to the classic copy.
- In the lab's observations, exception stack traces were the same and live call stacks were shorter (each method
  appears once). Read the lab doc before relying on tools that expect `IAsyncStateMachine` types.

### 8. Native AOT — a deployment trade-off
- The companion CLI publishes three ways. The measured table in [BENCHMARKS.md](BENCHMARKS.md) shows the
  size/startup/memory trade-off on the recorded machine. Re-run `scripts/publish-compare.sh` on yours.
- AOT needs the platform toolchain, cannot cross-compile across operating systems, and requires trim/AOT-safe code
  (e.g. source-generated JSON).

### 9. AI — abstractions first
- Code against `IChatClient`. Providers (OpenAI, Azure OpenAI, any OpenAI-compatible endpoint such as Ollama)
  are configuration, and keys come from user-secrets or environment variables.
- `UseFunctionInvocation()` turns `AIFunction`s into tools. The offline mock emits real `FunctionCallContent`, so
  the whole pipeline runs with no network.
- MCP servers expose tools to any MCP client. `McpClientTool` derives from `AIFunction`, so MCP tools plug straight
  into `IChatClient`. Blazor AI components are experimental and not used by stable code.

## Exercises

1. Add a `PaymentRefunded` case to the Lab 1 union and follow the compiler errors to every switch you must update.
2. In Lab 2, raise the duplicate-key rate and explain the row counts in each category.
3. In Lab 6, compare Zstandard with and without a trained dictionary as payload size grows. Where does the
   dictionary stop paying off?
4. In Lab 3, send a checkout request that fails both sync and async rules. How many lookups ran, and in what order?
5. Run `dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --filter "*Json*"` and compare your
   machine with the recorded results.
6. Move one method from `DotNet11Lab.Core/Labs/RuntimeAsync` into a new project with runtime async enabled, and
   confirm with reflection (as Lab 7 does) that its state machine disappears.
