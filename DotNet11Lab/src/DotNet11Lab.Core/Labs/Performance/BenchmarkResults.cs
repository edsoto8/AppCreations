using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DotNet11Lab.Core.Labs.Performance;

// This file is compiled into DotNet11Lab.Core (the dashboard reads results/benchmarks/latest.json) and linked into
// DotNet11Lab.Benchmarks (which writes it after a run), so reader and writer share one schema. BCL-only, net10-safe.

/// <summary>Machine and tool versions recorded with a benchmark run.</summary>
public sealed record BenchmarkMachineInfo(
    string Os,
    string Processor,
    int? PhysicalCores,
    int? LogicalCores,
    string Architecture,
    string HostRuntime,
    string? DotNetSdk,
    string BenchmarkDotNetVersion);

/// <summary>One benchmark method on one runtime. Times are nanoseconds per operation.</summary>
public sealed record BenchmarkResultEntry(
    string Category,
    string Type,
    string Method,
    string Parameters,
    string Runtime,
    string? RuntimeVersion,
    bool IsBaseline,
    double MeanNs,
    double? StdDevNs,
    double? MedianNs,
    long? AllocatedBytes,
    double? Gen0Per1000Ops,
    double? Ratio = null,
    double? AllocatedRatio = null)
{
    /// <summary>Identifies the same benchmark across runtimes.</summary>
    [JsonIgnore]
    public string Key => Parameters.Length == 0 ? $"{Type}.{Method}" : $"{Type}.{Method}({Parameters})";
}

/// <summary>The compact file <c>results/benchmarks/latest.json</c>.</summary>
public sealed record BenchmarkResultsFile(
    int SchemaVersion,
    DateTimeOffset GeneratedUtc,
    bool Preliminary,
    string Mode,
    string? Note,
    BenchmarkMachineInfo Machine,
    IReadOnlyList<BenchmarkResultEntry> Results)
{
    public const int CurrentSchemaVersion = 1;
}

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(BenchmarkResultsFile))]
internal sealed partial class BenchmarkResultsJsonContext : JsonSerializerContext;

public static class BenchmarkResultsJson
{
    public static string Serialize(BenchmarkResultsFile file) =>
        JsonSerializer.Serialize(file, BenchmarkResultsJsonContext.Default.BenchmarkResultsFile);

    /// <summary>Parses and validates a results file. Throws <see cref="InvalidDataException"/> when it is not usable.</summary>
    public static BenchmarkResultsFile Deserialize(string json)
    {
        BenchmarkResultsFile? file;
        try
        {
            file = JsonSerializer.Deserialize(json, BenchmarkResultsJsonContext.Default.BenchmarkResultsFile);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"The benchmark results file is not valid JSON: {ex.Message}", ex);
        }
        if (file is null) throw new InvalidDataException("The benchmark results file is empty.");
        if (file.SchemaVersion != BenchmarkResultsFile.CurrentSchemaVersion)
            throw new InvalidDataException($"Unsupported schemaVersion {file.SchemaVersion} (expected {BenchmarkResultsFile.CurrentSchemaVersion}).");
        if (file.Results is null || file.Machine is null)
            throw new InvalidDataException("The benchmark results file is missing 'results' or 'machine'.");
        return file;
    }

    /// <summary>Suffix pair used by same-runtime comparisons (Lab 7): <c>X_RuntimeAsync</c> is compared with <c>X_Classic</c>.</summary>
    public const string ClassicSuffix = "_Classic", RuntimeAsyncSuffix = "_RuntimeAsync";

    /// <summary>
    /// Fills <see cref="BenchmarkResultEntry.Ratio"/> and <see cref="BenchmarkResultEntry.AllocatedRatio"/>: each entry divided
    /// by the baseline-runtime entry of the same benchmark (BenchmarkDotNet's Ratio column uses the same definition).
    /// Same-runtime pairs (<c>*_RuntimeAsync</c> vs <c>*_Classic</c>) are compared with their classic twin instead.
    /// Benchmarks with no baseline (e.g. Zstandard, .NET 11 only) keep null ratios.
    /// </summary>
    public static IReadOnlyList<BenchmarkResultEntry> WithRatios(IEnumerable<BenchmarkResultEntry> entries)
    {
        var list = entries.ToList();
        var baselines = list.Where(e => e.IsBaseline).GroupBy(e => e.Key).ToDictionary(g => g.Key, g => g.First());
        var classic = list.Where(e => e.Method.EndsWith(ClassicSuffix, StringComparison.Ordinal))
            .GroupBy(e => (e.Runtime, e.Key)).ToDictionary(g => g.Key, g => g.First());
        return list.Select(e =>
        {
            BenchmarkResultEntry? b = null;
            if (e.Method.EndsWith(RuntimeAsyncSuffix, StringComparison.Ordinal) || e.Method.EndsWith(ClassicSuffix, StringComparison.Ordinal))
            {
                var twin = e with { Method = TwinMethod(e.Method) };
                classic.TryGetValue((e.Runtime, twin.Key), out b);
                if (e.Method.EndsWith(ClassicSuffix, StringComparison.Ordinal)) b = e;
            }
            else
            {
                baselines.TryGetValue(e.Key, out b);
            }
            if (b is null || b.MeanNs <= 0) return e with { Ratio = null, AllocatedRatio = null };
            double? allocRatio = b.AllocatedBytes is > 0 && e.AllocatedBytes is not null
                ? (double)e.AllocatedBytes.Value / b.AllocatedBytes.Value
                : null;
            return e with { Ratio = e.MeanNs / b.MeanNs, AllocatedRatio = allocRatio };
        }).ToList();
    }

    private static string TwinMethod(string method) => method.EndsWith(RuntimeAsyncSuffix, StringComparison.Ordinal)
        ? method[..^RuntimeAsyncSuffix.Length] + ClassicSuffix
        : method;

    /// <summary>A GitHub-flavoured markdown table of the file, written next to latest.json.</summary>
    public static string ToMarkdown(BenchmarkResultsFile file)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendLine("# Benchmark results");
        sb.AppendLine();
        if (file.Preliminary)
        {
            sb.AppendLine("> **PRELIMINARY** - produced by a smoke/validation run (short job and/or a contended machine). Do not quote these numbers.");
            sb.AppendLine();
        }
        sb.AppendLine(inv, $"- Generated: {file.GeneratedUtc:u} · mode `{file.Mode}`");
        var m = file.Machine;
        sb.AppendLine(inv, $"- Machine: {m.Processor} ({m.PhysicalCores?.ToString(inv) ?? "?"} physical / {m.LogicalCores?.ToString(inv) ?? "?"} logical cores, {m.Architecture}), {m.Os}");
        sb.AppendLine(inv, $"- Host runtime: {m.HostRuntime} · SDK {m.DotNetSdk ?? "?"} · BenchmarkDotNet {m.BenchmarkDotNetVersion}");
        if (!string.IsNullOrWhiteSpace(file.Note)) sb.AppendLine(inv, $"- Note: {file.Note}");
        sb.AppendLine();
        sb.AppendLine("| Category | Benchmark | Runtime | Mean | Ratio | Allocated | Alloc ratio |");
        sb.AppendLine("|---|---|---|---:|---:|---:|---:|");
        foreach (var r in file.Results.OrderBy(r => r.Category, StringComparer.Ordinal).ThenBy(r => r.Key, StringComparer.Ordinal).ThenBy(r => r.Runtime, StringComparer.Ordinal))
        {
            sb.AppendLine(inv, $"| {r.Category} | {r.Key} | {r.Runtime} | {FormatNs(r.MeanNs)} | {(r.Ratio is { } ratio ? ratio.ToString("0.00", inv) : "-")} | {(r.AllocatedBytes is { } a ? FormatBytes(a) : "-")} | {(r.AllocatedRatio is { } ar ? ar.ToString("0.00", inv) : "-")} |");
        }
        return sb.ToString();
    }

    public static string FormatNs(double ns) => ns switch
    {
        < 1_000 => ns.ToString("0.0", CultureInfo.InvariantCulture) + " ns",
        < 1_000_000 => (ns / 1_000).ToString("0.00", CultureInfo.InvariantCulture) + " µs",
        < 1_000_000_000 => (ns / 1_000_000).ToString("0.00", CultureInfo.InvariantCulture) + " ms",
        _ => (ns / 1_000_000_000).ToString("0.00", CultureInfo.InvariantCulture) + " s",
    };

    public static string FormatBytes(long bytes) => bytes switch
    {
        < 1024 => bytes.ToString(CultureInfo.InvariantCulture) + " B",
        < 1024 * 1024 => (bytes / 1024d).ToString("0.0", CultureInfo.InvariantCulture) + " KB",
        _ => (bytes / (1024d * 1024)).ToString("0.00", CultureInfo.InvariantCulture) + " MB",
    };
}
