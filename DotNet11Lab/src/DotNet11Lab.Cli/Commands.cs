using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace DotNet11Lab.Cli;

/// <summary>Summarises a JSON Lines stream of <see cref="Transaction"/>s. Streams line by line (constant memory).</summary>
public static class StatsCommand
{
    public const int MaxLineChars = 64 * 1024;
    public const int MaxReportedErrors = 5;
    public const int TopCategoryCount = 10;

    public static async Task<StatsReport> ComputeAsync(TextReader input, CancellationToken cancellationToken)
    {
        var currencies = new Dictionary<string, (int Count, decimal Total, decimal Min, decimal Max)>(StringComparer.Ordinal);
        var categories = new Dictionary<(string Category, string Currency), (int Count, decimal Total)>();
        var errors = new List<string>();
        int count = 0, invalid = 0, lineNumber = 0;
        DateTimeOffset? first = null, last = null;

        while (await input.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            lineNumber++;
            if (string.IsNullOrWhiteSpace(line)) continue;
            Transaction? t = null;
            string? problem = null;
            if (line.Length > MaxLineChars)
            {
                problem = $"line longer than {MaxLineChars} characters";
            }
            else
            {
                try
                {
                    t = JsonSerializer.Deserialize(line, CliJsonContext.Default.Transaction);
                    if (t is null || string.IsNullOrEmpty(t.Currency) || string.IsNullOrEmpty(t.Category)) problem = "missing currency or category";
                }
                catch (JsonException ex)
                {
                    problem = ex.Message;
                }
            }
            if (problem is not null || t is null)
            {
                invalid++;
                if (errors.Count < MaxReportedErrors) errors.Add($"line {lineNumber}: {problem}");
                continue;
            }

            count++;
            first = first is null || t.Timestamp < first ? t.Timestamp : first;
            last = last is null || t.Timestamp > last ? t.Timestamp : last;
            currencies[t.Currency] = currencies.TryGetValue(t.Currency, out var c)
                ? (c.Count + 1, c.Total + t.Amount, Math.Min(c.Min, t.Amount), Math.Max(c.Max, t.Amount))
                : (1, t.Amount, t.Amount, t.Amount);
            var key = (t.Category, t.Currency);
            categories[key] = categories.TryGetValue(key, out var k) ? (k.Count + 1, k.Total + t.Amount) : (1, t.Amount);
        }

        return new StatsReport(
            count,
            invalid,
            first,
            last,
            currencies.OrderBy(c => c.Key, StringComparer.Ordinal)
                .Select(c => new CurrencySummary(c.Key, c.Value.Count, c.Value.Total, c.Value.Min, c.Value.Max, Math.Round(c.Value.Total / c.Value.Count, 2)))
                .ToList(),
            categories.OrderByDescending(c => Math.Abs(c.Value.Total)).ThenBy(c => c.Key.Category, StringComparer.Ordinal).Take(TopCategoryCount)
                .Select(c => new CategorySummary(c.Key.Category, c.Key.Currency, c.Value.Count, c.Value.Total))
                .ToList(),
            errors);
    }

    public static string FormatText(StatsReport r)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendLine(inv, $"Transactions: {r.Transactions:N0}   invalid lines: {r.InvalidLines:N0}");
        if (r.First is { } f && r.Last is { } l) sb.AppendLine(inv, $"Period:       {f:u} .. {l:u}");
        sb.AppendLine();
        sb.AppendLine("Currency      Count           Total             Min             Max            Mean");
        foreach (var c in r.ByCurrency)
            sb.AppendLine(inv, $"{c.Currency,-8} {c.Count,10:N0} {c.Total,15:N2} {c.Min,15:N2} {c.Max,15:N2} {c.Mean,15:N2}");
        if (r.TopCategories.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Top categories by absolute total");
            foreach (var c in r.TopCategories)
                sb.AppendLine(inv, $"  {c.Category,-16} {c.Currency,-4} {c.Count,10:N0} {c.Total,15:N2}");
        }
        foreach (var e in r.Errors) sb.AppendLine(inv, $"warning: {e}");
        return sb.ToString();
    }
}

/// <summary>Generates deterministic sample transactions as JSON Lines.</summary>
public static class GenerateCommand
{
    public const int MaxCount = 10_000_000;
    private static readonly string[] Categories = ["groceries", "rent", "salary", "utilities", "travel", "dining", "health", "software", "insurance", "refund"];
    private static readonly string[] Currencies = ["EUR", "EUR", "EUR", "USD", "GBP"];

    public static IEnumerable<Transaction> Generate(int count, int seed)
    {
        if (count is < 0 or > MaxCount) throw new ArgumentOutOfRangeException(nameof(count), $"count must be between 0 and {MaxCount:N0}.");
        var random = new Random(seed);
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < count; i++)
        {
            var category = Categories[random.Next(Categories.Length)];
            var amount = category switch
            {
                "salary" => random.Next(250_000, 600_000) / 100m,
                "refund" => random.Next(100, 20_000) / 100m,
                "rent" => -random.Next(80_000, 200_000) / 100m,
                _ => -random.Next(100, 30_000) / 100m,
            };
            yield return new Transaction(
                $"tx-{i + 1:D8}",
                start.AddSeconds(random.Next(0, 365 * 24 * 3600)),
                $"ACC-{random.Next(1, 50):D4}",
                category,
                amount,
                Currencies[random.Next(Currencies.Length)]);
        }
    }

    public static async Task WriteAsync(TextWriter output, int count, int seed, CancellationToken cancellationToken)
    {
        foreach (var t in Generate(count, seed))
        {
            cancellationToken.ThrowIfCancellationRequested();
            await output.WriteLineAsync(JsonSerializer.Serialize(t, CliJsonContext.Default.Transaction)).ConfigureAwait(false);
        }
        await output.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
}

/// <summary>Zstandard file compression with the in-box .NET 11 <see cref="ZstandardStream"/>.</summary>
public static class CompressCommand
{
    public static int MinQuality => ZstandardCompressionOptions.MinQuality;
    public static int MaxQuality => ZstandardCompressionOptions.MaxQuality;

    public static async Task<CompressReport> CompressAsync(Stream input, Stream output, int quality, CancellationToken cancellationToken)
    {
        if (quality < MinQuality || quality > MaxQuality)
            throw new ArgumentOutOfRangeException(nameof(quality), $"quality must be between {MinQuality} and {MaxQuality}.");
        var sw = Stopwatch.StartNew();
        var options = new ZstandardCompressionOptions { Quality = quality };
        var before = output.CanSeek ? output.Position : 0;
        long read;
        await using (var zstd = new ZstandardStream(output, options, leaveOpen: true))
        {
            read = await CopyCountingAsync(input, zstd, cancellationToken).ConfigureAwait(false);
        }
        return new CompressReport("compress", "", "", read, output.CanSeek ? output.Position - before : -1, quality, sw.Elapsed.TotalMilliseconds);
    }

    public static async Task<CompressReport> DecompressAsync(Stream input, Stream output, CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        var before = input.CanSeek ? input.Position : 0;
        long written;
        await using (var zstd = new ZstandardStream(input, CompressionMode.Decompress, leaveOpen: true))
        {
            written = await CopyCountingAsync(zstd, output, cancellationToken).ConfigureAwait(false);
        }
        return new CompressReport("decompress", "", "", input.CanSeek ? input.Position - before : -1, written, 0, sw.Elapsed.TotalMilliseconds);
    }

    private static async Task<long> CopyCountingAsync(Stream source, Stream destination, CancellationToken cancellationToken)
    {
        var buffer = new byte[81920];
        long total = 0;
        int n;
        while ((n = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            await destination.WriteAsync(buffer.AsMemory(0, n), cancellationToken).ConfigureAwait(false);
            total += n;
        }
        return total;
    }
}

/// <summary>Self-reported startup and memory facts, used by the publish comparison scripts.</summary>
public static class StartupProbe
{
    public static StartupProbeResult Capture(DateTime mainEnteredUtc, long mainEnteredTimestamp)
    {
        var mainToProbe = Stopwatch.GetElapsedTime(mainEnteredTimestamp).TotalMilliseconds;
        using var process = Process.GetCurrentProcess();
        double? startToMain = null;
        try
        {
            // OS-reported start time: coarse (clock ticks, typically 10 ms on Linux), so the scripts also time
            // the whole launch externally with a high-resolution clock.
            startToMain = (mainEnteredUtc - process.StartTime.ToUniversalTime()).TotalMilliseconds;
        }
        catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception)
        {
        }
        return new StartupProbeResult(
            startToMain,
            mainToProbe,
            process.WorkingSet64,
            process.PeakWorkingSet64,
            GC.GetTotalMemory(forceFullCollection: false), // GetGCMemoryInfo() is all zeros until the first GC
            RuntimeInformation.FrameworkDescription,
            RuntimeInformation.RuntimeIdentifier,
            RuntimeInformation.OSDescription,
            RuntimeFeature.IsDynamicCodeSupported,
            RuntimeFeature.IsDynamicCodeCompiled,
            System.Runtime.JitInfo.GetCompiledMethodCount(),
            Environment.ProcessPath ?? "",
            Environment.ProcessId);
    }
}
