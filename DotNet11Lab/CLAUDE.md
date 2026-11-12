# CLAUDE.md — DotNet11Lab

Guidance for working in `DotNet11Lab/`. Run every command from this folder.

## Environment

- Requires **.NET SDK 11.0.100** (pinned in `global.json`). The .NET 10 runtime is only needed for the
  cross-runtime benchmarks (`DotNet11Lab.Benchmarks` multi-targets `net10.0;net11.0`).
- `global.json` sets `"test": {"runner": "Microsoft.Testing.Platform"}`, so `dotnet test` runs xUnit v3 on MTP.
  The syntax is `dotnet test --solution DotNet11Lab.slnx` or `dotnet test --project tests/DotNet11Lab.Tests`.
  Filters use xUnit's MTP options, e.g. `-- --filter-class "*Lab1*"` or `--filter-query`.
- `Directory.Build.props`: `net11.0`, `LangVersion 15`, nullable, implicit usings, **TreatWarningsAsErrors**,
  central package management (`Directory.Packages.props`: add versions there, never in a csproj).

## Commands

```bash
dotnet build DotNet11Lab.slnx
dotnet test --solution DotNet11Lab.slnx
dotnet run --project src/DotNet11Lab.Web            # dashboard + /api on http://localhost:5180
dotnet run --project src/DotNet11Lab.Api            # API alone on http://localhost:5181
dotnet run -c Release --project src/DotNet11Lab.Benchmarks -- --help
dotnet run --project src/DotNet11Lab.Cli -- --help
```

## Architecture (see ARCHITECTURE.md)

| Project | Role |
|---|---|
| `src/DotNet11Lab.Core` | All demonstration logic, UI-free and testable. One folder per lab: `Labs/<Area>/`. |
| `src/DotNet11Lab.Api` | Minimal API for Lab 3. `AddLabApi()`/`MapLabApi()` are used by the Web host and by its own `ApiHost.Main`. Plain SDK + `FrameworkReference Microsoft.AspNetCore.App` (not the Web SDK, which would clash with the dashboard's static assets). |
| `src/DotNet11Lab.Web` | Blazor Web App. Static SSR by default, with `@rendermode InteractiveServer` on lab pages that need it. Hosts `/api` and `/openapi/v1.json` in-process. |
| `src/DotNet11Lab.Benchmarks` | BenchmarkDotNet for `net10.0` and `net11.0`. Does not reference Core. |
| `src/DotNet11Lab.Cli` | Companion CLI (`dotnet11lab`) for Native AOT comparisons. |
| `experimental/DotNet11Lab.RuntimeAsync` | **The only assembly with `<Features>runtime-async=on</Features>`.** |
| `tests/DotNet11Lab.Tests` | xUnit v3 (MTP). One folder per lab plus `Infrastructure/`. |

## Conventions every lab follows

1. **Real code only.** Demonstrations run real APIs. Numbers are measured at runtime and never hard-coded.
   Show an experimental API only if it is labelled and isolated.
2. **Code shown in the UI is the code that runs.** Projects with `EmbedLabSources=true` (Core, Api,
   RuntimeAsync, Web) embed their `.cs` files. Mark regions with comment lines `// <snippet:Id>` and
   `// </snippet:Id>` (ids are globally unique, PascalCase, prefixed by area, e.g. `Unions.PaymentResult`), then
   render them with `<CodeBlock Snippet="Unions.PaymentResult" />` or `<CodeCompare OldSnippet=... NewSnippet=... />`.
   Snippets may nest. `SourceCatalog.Get` throws for an unknown id, and the tests check that every id used in
   Razor exists.
3. **Before/after.** For each feature, keep the "previous approach" (C# 14 / .NET 10 style) as real, compiled
   code next to the new approach, and show both.
4. **Lab pages** live in `src/DotNet11Lab.Web/Components/Pages/Labs/<Name>Lab.razor`. Start with
   `<LabHeader Slug="..." />`, then use `DemoPanel` (with `OnRun` taking a `CancellationToken`, and a `Result`
   fragment), `CodeBlock`, `CodeCompare`, `BarChart`, `MetricTile`, `Callout`, and `UsageGuidance` (when to use
   and when to avoid). Use the CSS classes in `wwwroot/app.css` (`card`, `grid grid-2`, `table.data`,
   `result-box`, `badge-*`, `tabs`/`tab`). Do not add CSS frameworks or JS chart libraries.
5. **DI**: implement your lab's partial method in `LabServiceRegistration` (Core) or `LabWebServices` (Web),
   in your own file. Do not edit the files that declare them.
6. **Lab catalog** (`Core/Catalog/LabCatalog.cs`) drives the navigation and feature table. Keep it in sync
   with `FEATURE_MATRIX.md`.
7. Pass `CancellationToken` through all async work. Validate inputs and cap sizes that users can set.
8. **Tests**: put them in `tests/DotNet11Lab.Tests/<LabFolder>/`. Use `TestContext.Current.CancellationToken`.
   Use `Infrastructure/LabWebFactory` for HTTP-level tests.

## Verified facts (do not "correct" these from memory)

- C# 15 unions lower to a struct implementing `IUnion` (`object? Value`). Patterns apply to the contained value.
  `default(Union).Value` is null.
- `closed` implies abstract (`closed abstract` is error CS9384).
- An extension indexer is not considered when the receiver already has an applicable instance indexer.
- `LeftJoin`/`RightJoin` are .NET 10. `FullJoin` and tuple-returning `Join`/`GroupJoin` are .NET 11.
- Runtime async: off by default for user code. `<Features>runtime-async=on</Features>` produces
  `MethodImplAttributes.Async` methods with no state machine type.
- Minimal API `AddValidation()` runs `AsyncValidationAttribute` from this non-Web-SDK Api project, and the OpenAPI
  document is `3.2.0` by default (both verified).
