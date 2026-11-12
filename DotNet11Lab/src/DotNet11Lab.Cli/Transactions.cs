using System.Text.Json;
using System.Text.Json.Serialization;

namespace DotNet11Lab.Cli;

/// <summary>One line of the JSON Lines input/output.</summary>
public sealed record Transaction(
    string Id,
    DateTimeOffset Timestamp,
    string Account,
    string Category,
    decimal Amount,
    string Currency);

public sealed record CurrencySummary(string Currency, int Count, decimal Total, decimal Min, decimal Max, decimal Mean);

public sealed record CategorySummary(string Category, string Currency, int Count, decimal Total);

public sealed record StatsReport(
    int Transactions,
    int InvalidLines,
    DateTimeOffset? First,
    DateTimeOffset? Last,
    IReadOnlyList<CurrencySummary> ByCurrency,
    IReadOnlyList<CategorySummary> TopCategories,
    IReadOnlyList<string> Errors);

public sealed record CompressReport(string Operation, string Input, string Output, long InputBytes, long OutputBytes, int Quality, double ElapsedMs);

/// <summary>Printed by <c>--startup-probe</c>; read by scripts/publish-compare.*.</summary>
public sealed record StartupProbeResult(
    double? StartToMainMs,
    double MainToProbeMs,
    long WorkingSetBytes,
    long PeakWorkingSetBytes,
    long GcHeapBytes,
    string Runtime,
    string RuntimeIdentifier,
    string Os,
    bool IsDynamicCodeSupported,
    bool IsDynamicCodeCompiled,
    long JitCompiledMethods,
    string ProcessPath,
    int ProcessId);

// Source-generated System.Text.Json metadata: no reflection at run time, so the CLI is trim- and AOT-safe
// (IsAotCompatible=true turns any reflection-based serializer call into a build error here).
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(Transaction))]
[JsonSerializable(typeof(StatsReport))]
[JsonSerializable(typeof(CompressReport))]
[JsonSerializable(typeof(StartupProbeResult))]
public sealed partial class CliJsonContext : JsonSerializerContext;
