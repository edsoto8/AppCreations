namespace DotNet11Lab.Core.Catalog;

/// <summary>How production-ready a feature is in the .NET 11 GA release.</summary>
public enum FeatureStatus
{
    /// <summary>Generally available; no opt-in required.</summary>
    Stable,
    /// <summary>Generally available but must be enabled explicitly (MSBuild property, feature flag, package).</summary>
    OptIn,
    /// <summary>Preview package, [Experimental] diagnostic or compiler feature flag. Isolated from the stable app.</summary>
    Experimental,
    /// <summary>Shipped before .NET 11; shown only as the comparison baseline.</summary>
    Baseline,
}

public sealed record DocLink(string Title, string Url);

public sealed record FeatureInfo(
    string Name,
    FeatureStatus Status,
    bool NewInDotNet11,
    string Summary,
    DocLink Docs);

public sealed record LabInfo(
    int Number,
    string Slug,
    string Title,
    string Category,
    string Icon,
    string Tagline,
    IReadOnlyList<FeatureInfo> Features)
{
    public string Route => $"/labs/{Slug}";
}

/// <summary>
/// Single source of truth for the dashboard: navigation, the home page compatibility table and every lab header
/// are generated from this list. Statuses here mirror FEATURE_MATRIX.md.
/// </summary>
public static class LabCatalog
{
    private const string Learn = "https://learn.microsoft.com";

    public static IReadOnlyList<LabInfo> Labs { get; } =
    [
        new(1, "csharp15", "C# 15 Language", "Language", "λ",
            "Unions, closed hierarchies, collection arguments, extension indexers and labeled loops.",
            [
                new("Union types", FeatureStatus.Stable, true,
                    "union Payment(Approved, Declined); exhaustive matching over a closed set of case types.",
                    new("Union types", $"{Learn}/dotnet/csharp/language-reference/builtin-types/union")),
                new("Closed hierarchies", FeatureStatus.Stable, true,
                    "closed record State; all derived types known to the compiler, so switches are exhaustive.",
                    new("closed modifier", $"{Learn}/dotnet/csharp/language-reference/keywords/closed")),
                new("Collection expression arguments", FeatureStatus.Stable, true,
                    "[with(capacity: n), ..items] passes constructor arguments such as capacity or comparer.",
                    new("Proposal", $"{Learn}/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments")),
                new("Extension indexers", FeatureStatus.Stable, true,
                    "this[...] declared inside an extension block adds indexers to types you do not own.",
                    new("Extension members", $"{Learn}/dotnet/csharp/language-reference/keywords/extension#extension-indexers")),
                new("Labeled break / continue", FeatureStatus.Stable, true,
                    "break outer; leaves nested loops without flags or goto.",
                    new("What's new in C# 15", $"{Learn}/dotnet/csharp/whats-new/csharp-15")),
            ]),
        new(2, "linq", "LINQ Joins", "Libraries", "⋈",
            "FullJoin and tuple-returning joins power a financial reconciliation tool.",
            [
                new("Enumerable.FullJoin", FeatureStatus.Stable, true,
                    "All elements from both sides; default on the side with no match.",
                    new("Enumerable.FullJoin", $"{Learn}/dotnet/api/system.linq.enumerable.fulljoin")),
                new("Tuple-returning Join / GroupJoin", FeatureStatus.Stable, true,
                    "Join without a result selector returns (Outer, Inner) tuples.",
                    new(".NET 11 libraries", $"{Learn}/dotnet/core/whats-new/dotnet-11/libraries")),
                new("LeftJoin / RightJoin", FeatureStatus.Baseline, false,
                    "Introduced in .NET 10; used here as the comparison baseline.",
                    new("Join operations", $"{Learn}/dotnet/csharp/linq/standard-query-operators/join-operations")),
            ]),
        new(3, "aspnetcore", "ASP.NET Core 11", "Web", "⇄",
            "API playground: async validation, unions in JSON, OpenAPI 3.2 and ProblemDetails.",
            [
                new("Async DataAnnotations validation", FeatureStatus.Stable, true,
                    "AsyncValidationAttribute and IAsyncValidatableObject run in Minimal APIs via AddValidation().",
                    new("What's new in ASP.NET Core 11", $"{Learn}/aspnet/core/release-notes/aspnetcore-11")),
                new("OpenAPI 3.2", FeatureStatus.Stable, true,
                    "3.2 is the default document version; OpenApiOptions.OpenApiVersion selects others.",
                    new("OpenAPI in ASP.NET Core", $"{Learn}/aspnet/core/fundamentals/openapi/overview")),
                new("Unions in JSON bodies", FeatureStatus.Stable, true,
                    "Union return values serialize as their active case; OpenAPI describes them with anyOf.",
                    new("Union types in System.Text.Json", $"{Learn}/dotnet/standard/serialization/system-text-json/union-types")),
                new("ProblemDetails", FeatureStatus.Baseline, false,
                    "Structured errors (RFC 9457). No changes in 11; used for consistent error payloads.",
                    new("Handle errors", $"{Learn}/aspnet/core/fundamentals/error-handling")),
            ]),
        new(4, "blazor", "Blazor 11", "Web", "◧",
            "Async form validation, QuickGrid URL navigation and a 100k-row virtualized explorer.",
            [
                new("Async form validation", FeatureStatus.Stable, true,
                    "EditForm awaits async validators; EditContext.IsValidationPending tracks progress.",
                    new("Async validation", $"{Learn}/aspnet/core/blazor/forms/validation-advanced?view=aspnetcore-11.0#asynchronous-validation")),
                new("QuickGrid URL navigation", FeatureStatus.Stable, true,
                    "Paging and sorting state live in the query string; OnRowClick.",
                    new("QuickGrid", $"{Learn}/aspnet/core/blazor/components/quickgrid?view=aspnetcore-11.0")),
                new("Virtualize navigation", FeatureStatus.Stable, true,
                    "InitialItemIndex, ScrollToItemAsync and variable item heights.",
                    new("Virtualization", $"{Learn}/aspnet/core/blazor/components/virtualization?view=aspnetcore-11.0")),
                new("QuickGrid AnchorMode / ItemComparer", FeatureStatus.Experimental, true,
                    "Flagged ASP0030. Not used in the stable app.",
                    new("What's new in ASP.NET Core 11", $"{Learn}/aspnet/core/release-notes/aspnetcore-11")),
            ]),
        new(5, "performance", "Runtime Performance", "Runtime", "⏱",
            "Live micro-measurements plus BenchmarkDotNet results from .NET 10 and .NET 11.",
            [
                new("JIT / GC improvements", FeatureStatus.Stable, true,
                    "Identical workloads benchmarked on .NET 10.0 and .NET 11.0 runtimes.",
                    new(".NET 11 runtime", $"{Learn}/dotnet/core/whats-new/dotnet-11/runtime")),
            ]),
        new(6, "libraries", "Library Features", "Libraries", "▤",
            "Zstandard, zero-copy stream adapters, JSON Lines and System.Text.Json updates.",
            [
                new("Zstandard compression", FeatureStatus.Stable, true,
                    "ZstandardStream, ZstandardEncoder/Decoder and trained dictionaries, in-box.",
                    new(".NET 11 libraries", $"{Learn}/dotnet/core/whats-new/dotnet-11/libraries")),
                new("Memory stream adapters", FeatureStatus.Stable, true,
                    "ReadOnlyMemoryStream, WritableMemoryStream, StringStream, ReadOnlySequenceStream.",
                    new(".NET 11 libraries", $"{Learn}/dotnet/core/whats-new/dotnet-11/libraries")),
                new("JSON Lines output", FeatureStatus.Stable, true,
                    "SerializeAsyncEnumerable(..., topLevelValues: true) streams newline-delimited JSON.",
                    new(".NET 11 libraries", $"{Learn}/dotnet/core/whats-new/dotnet-11/libraries")),
                new("System.Text.Json unions", FeatureStatus.Stable, true,
                    "C# unions serialize as the active case; JsonUnionTypeStructuralClassifier for objects.",
                    new("Union types", $"{Learn}/dotnet/standard/serialization/system-text-json/union-types")),
            ]),
        new(7, "runtime-async", "Runtime Async", "Runtime", "⟳",
            "Opt-in runtime-managed async compared with compiler state machines, isolated in one assembly.",
            [
                new("Runtime Async", FeatureStatus.OptIn, true,
                    "<Features>runtime-async=on</Features> emits MethodImplAttributes.Async methods with no state machine.",
                    new(".NET 11 runtime", $"{Learn}/dotnet/core/whats-new/dotnet-11/runtime")),
            ]),
        new(8, "native-aot", "Native AOT & Publishing", "Deployment", "⬢",
            "Framework-dependent vs self-contained vs Native AOT: size, startup and memory, measured.",
            [
                new("Native AOT", FeatureStatus.Stable, false,
                    "Ahead-of-time compiled single native executable; measured against the other modes.",
                    new("Native AOT deployment", $"{Learn}/dotnet/core/deploying/native-aot/")),
            ]),
        new(9, "ai", "AI Integration", "AI", "✦",
            "Microsoft.Extensions.AI with pluggable providers, tool calling and an offline mock.",
            [
                new("Microsoft.Extensions.AI", FeatureStatus.Stable, false,
                    "IChatClient abstraction, middleware pipeline and automatic function invocation.",
                    new("Microsoft.Extensions.AI", $"{Learn}/dotnet/ai/microsoft-extensions-ai")),
                new("MCP C# SDK", FeatureStatus.Stable, false,
                    "Expose .NET methods as Model Context Protocol tools; mcpserver template in SDK 11.",
                    new("Get started with MCP", $"{Learn}/dotnet/ai/get-started-mcp")),
                new("Blazor AI components", FeatureStatus.Experimental, true,
                    "Microsoft.AspNetCore.Components.AI is a prerelease package throughout .NET 11.",
                    new("Blazor AI components", $"{Learn}/aspnet/core/blazor/components/ai-components?view=aspnetcore-11.0")),
            ]),
    ];

    public static LabInfo Get(string slug) =>
        Labs.FirstOrDefault(l => l.Slug == slug) ?? throw new KeyNotFoundException($"Unknown lab '{slug}'.");
}
