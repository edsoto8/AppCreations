using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Runtime;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using DotNet11Lab.Core.Catalog;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Core.Labs.Ai;

public sealed record FeatureDto(int Lab, string LabTitle, string Name, string Status, bool NewInDotNet11, string Summary, string DocsUrl);

public sealed record LabFeaturesResult(int Lab, string Title, string Tagline, IReadOnlyList<FeatureDto> Features);

public sealed record CompressionResult(
    int OriginalBytes, int ZstandardBytes, int GZipBytes, int BrotliBytes, int Quality,
    double ZstandardRatio, double ZstandardMicroseconds, bool RoundTripVerified, bool UsedSampleText);

public sealed record RuntimeInfoResult(
    string Framework, string RuntimeVersion, string OperatingSystem, string ProcessArchitecture,
    int ProcessorCount, bool ServerGc, string GcLatencyMode, bool DynamicCodeCompiled);

public sealed record ReconciliationLine(string Id, decimal? Bank, decimal? Ledger, string Outcome);

public sealed record ReconciliationResult(int Matched, int AmountMismatches, int OnlyInBank, int OnlyInLedger, IReadOnlyList<ReconciliationLine> Lines, bool UsedSampleData);

/// <summary>
/// Real lab functionality exposed to models as tools. The same static methods back the in-process
/// <see cref="AIFunction"/>s (via <see cref="AIFunctionFactory"/>) and the MCP server in experimental/DotNet11Lab.Mcp,
/// so the tool names below are shared by both.
/// </summary>
public static class LabAiTools
{
    public const string GetLabFeaturesName = "get_lab_features";
    public const string SearchFeaturesName = "search_features";
    public const string MeasureZstandardName = "measure_zstandard";
    public const string GetRuntimeInfoName = "get_runtime_info";
    public const string ReconcileName = "reconcile_transactions";

    /// <summary>Upper bound for user/model supplied text, so a tool call cannot make the server compress megabytes.</summary>
    public const int MaxInputChars = 64 * 1024;
    public const int MaxReconciliationEntries = 200;

    // <snippet:Ai.Tools>
    /// <summary>Wraps plain .NET methods as <see cref="AIFunction"/>s. Names and descriptions become the JSON tool schema.</summary>
    public static IReadOnlyList<AIFunction> CreateFunctions() =>
    [
        AIFunctionFactory.Create(GetLabFeatures, GetLabFeaturesName,
            "Lists the .NET 11 features demonstrated by one DotNet 11 Lab laboratory (1-9)."),
        AIFunctionFactory.Create(SearchFeatures, SearchFeaturesName,
            "Searches the lab catalog for .NET 11 features whose name or summary contains the query."),
        AIFunctionFactory.Create(MeasureZstandard, MeasureZstandardName,
            "Compresses text with System.IO.Compression.ZstandardStream (new in .NET 11) and compares it with GZip and Brotli."),
        AIFunctionFactory.Create(GetRuntimeInfo, GetRuntimeInfoName,
            "Reports the .NET runtime, OS, architecture and GC mode of the process running the lab."),
        AIFunctionFactory.Create(ReconcileTransactions, ReconcileName,
            "Reconciles bank and ledger entries ('ID=amount;ID=amount') with Enumerable.FullJoin (new in .NET 11)."),
    ];

    public static LabFeaturesResult GetLabFeatures([Description("Lab number, 1 to 9.")] int labNumber)
    {
        var lab = LabCatalog.Labs.FirstOrDefault(l => l.Number == labNumber)
            ?? throw new ArgumentOutOfRangeException(nameof(labNumber), labNumber, $"Labs are numbered 1 to {LabCatalog.Labs.Count}.");
        return new(lab.Number, lab.Title, lab.Tagline, [.. lab.Features.Select(f => ToDto(lab, f))]);
    }
    // </snippet:Ai.Tools>

    public static IReadOnlyList<FeatureDto> SearchFeatures([Description("Words to look for, e.g. 'zstandard' or 'union'.")] string query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var words = query.Split([' ', ',', '-', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(w => w.Length >= 3)
            .Take(8)
            .ToArray();
        if (words.Length == 0) return [];

        return
        [
            .. from lab in LabCatalog.Labs
               from f in lab.Features
               let haystack = $"{f.Name} {f.Summary} {lab.Title}"
               let score = words.Count(w => haystack.Contains(w, StringComparison.OrdinalIgnoreCase))
                   + words.Count(w => f.Name.Contains(w, StringComparison.OrdinalIgnoreCase))
               where score > 0
               orderby score descending, lab.Number
               select ToDto(lab, f),
        ];
    }

    // <snippet:Ai.ZstandardTool>
    public static CompressionResult MeasureZstandard(
        [Description("Text to compress. Omit to use a built-in sample made of the lab catalog.")] string? text = null,
        [Description("Zstandard quality level, 1 (fastest) to 22 (smallest).")] int quality = 3)
    {
        var usedSample = string.IsNullOrEmpty(text);
        text = usedSample ? SampleText() : text![..Math.Min(text!.Length, MaxInputChars)];
        quality = Math.Clamp(quality, ZstandardCompressionOptions.MinQuality, ZstandardCompressionOptions.MaxQuality);
        var input = Encoding.UTF8.GetBytes(text);

        // Warm-up: the first ZstandardStream in a process loads the native codec; keep that out of the timing.
        using (var warm = new ZstandardStream(Stream.Null, CompressionLevel.Fastest)) warm.WriteByte(0);

        var sw = Stopwatch.StartNew();
        using var zstd = new MemoryStream();
        using (var z = new ZstandardStream(zstd, new ZstandardCompressionOptions { Quality = quality }, leaveOpen: true))
            z.Write(input);
        sw.Stop();

        using var restored = new MemoryStream();
        zstd.Position = 0;
        using (var d = new ZstandardStream(zstd, CompressionMode.Decompress, leaveOpen: true))
            d.CopyTo(restored);

        return new(input.Length, (int)zstd.Length,
            Compress(input, s => new GZipStream(s, CompressionLevel.Optimal, leaveOpen: true)),
            Compress(input, s => new BrotliStream(s, CompressionLevel.Optimal, leaveOpen: true)),
            quality, Math.Round((double)input.Length / Math.Max(1, zstd.Length), 2),
            Math.Round(sw.Elapsed.TotalMicroseconds, 1), restored.ToArray().AsSpan().SequenceEqual(input), usedSample);
    }
    // </snippet:Ai.ZstandardTool>

    public static RuntimeInfoResult GetRuntimeInfo() => new(
        RuntimeInformation.FrameworkDescription,
        Environment.Version.ToString(),
        RuntimeInformation.OSDescription,
        RuntimeInformation.ProcessArchitecture.ToString(),
        Environment.ProcessorCount,
        GCSettings.IsServerGC,
        GCSettings.LatencyMode.ToString(),
        RuntimeFeature.IsDynamicCodeCompiled);

    public static ReconciliationResult ReconcileTransactions(
        [Description("Bank statement entries, e.g. 'INV-1=100.00;INV-2=42.50'. Omit to use sample data.")] string? bank = null,
        [Description("Ledger entries in the same format. Omit to use sample data.")] string? ledger = null)
    {
        var usedSample = string.IsNullOrWhiteSpace(bank) || string.IsNullOrWhiteSpace(ledger);
        var bankEntries = ParseEntries(usedSample ? "INV-1001=250.00;INV-1002=99.90;INV-1003=1200.00;INV-1005=18.75" : bank!);
        var ledgerEntries = ParseEntries(usedSample ? "INV-1001=250.00;INV-1002=99.00;INV-1004=310.00;INV-1005=18.75" : ledger!);

        // .NET 11: FullJoin keeps unmatched rows from BOTH sides (default on the missing side).
        var lines = bankEntries.FullJoin(ledgerEntries, b => b.Id, l => l.Id,
                (b, l) => new ReconciliationLine(b.Id ?? l.Id!, b.Id is null ? null : b.Amount, l.Id is null ? null : l.Amount,
                    b.Id is null ? "only in ledger" : l.Id is null ? "only in bank" : b.Amount == l.Amount ? "matched" : "amount differs"))
            .OrderBy(x => x.Id, StringComparer.Ordinal)
            .ToList();

        return new(lines.Count(l => l.Outcome == "matched"), lines.Count(l => l.Outcome == "amount differs"),
            lines.Count(l => l.Outcome == "only in bank"), lines.Count(l => l.Outcome == "only in ledger"), lines, usedSample);
    }

    private static List<(string? Id, decimal Amount)> ParseEntries(string text) =>
    [
        .. text[..Math.Min(text.Length, MaxInputChars)]
            .Split([';', '\n', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(MaxReconciliationEntries)
            .Select(e => e.Split('=', 2, StringSplitOptions.TrimEntries))
            .Where(p => p.Length == 2 && p[0].Length > 0 && decimal.TryParse(p[1], NumberStyles.Number, CultureInfo.InvariantCulture, out _))
            .Select(p => ((string?)p[0], decimal.Parse(p[1], NumberStyles.Number, CultureInfo.InvariantCulture)))
            .DistinctBy(p => p.Item1),
    ];

    private static int Compress(byte[] input, Func<Stream, Stream> factory)
    {
        using var output = new MemoryStream();
        using (var s = factory(output)) s.Write(input);
        return (int)output.Length;
    }

    /// <summary>Deterministic, moderately repetitive text: every feature summary in the catalog, four times.</summary>
    internal static string SampleText() =>
        string.Join('\n', Enumerable.Repeat(0, 4).SelectMany(_ => LabCatalog.Labs.SelectMany(l => l.Features.Select(f => $"{l.Title}: {f.Name} - {f.Summary}"))));

    private static FeatureDto ToDto(LabInfo lab, FeatureInfo f) =>
        new(lab.Number, lab.Title, f.Name, f.Status.ToString(), f.NewInDotNet11, f.Summary, f.Docs.Url);
}
