using System.IO.Compression;
using System.Runtime.InteropServices;
using DotNet11Lab.Core.Diagnostics;
using DotNet11Lab.Core.Labs.Performance.Workloads;

namespace DotNet11Lab.Core.Labs.Performance;

/// <summary>A workload comparison the live page can run: the same groups as the BenchmarkDotNet categories.</summary>
public sealed record LiveGroup(
    string Id,
    string Title,
    string Description,
    string BenchmarkCategory,
    int BaseIterations,
    IReadOnlyList<LiveVariant> Variants);

/// <summary>One way of doing the work. <see cref="Run"/> performs one operation and returns a checksum.</summary>
public sealed record LiveVariant(string Name, string SnippetId, bool IsAsync, Func<CancellationToken, ValueTask<long>> Run, string ChecksumLabel = "result");

/// <summary>One measured variant. <see cref="SpeedupVsSlowest"/> is (slowest mean / this mean) within the group.</summary>
public sealed record LiveResult(
    string GroupId,
    string Workload,
    int Iterations,
    double MeanMicroseconds,
    double AllocatedBytesPerOp,
    double OpsPerSecond,
    int Gen0Collections,
    double SpeedupVsSlowest,
    long Checksum,
    string ChecksumLabel);

/// <summary>A live run. <see cref="Build"/> is "Release" or "Debug" (see <see cref="BuildInfo"/>).</summary>
public sealed record LiveRun(string RunId, DateTimeOffset StartedUtc, string Runtime, string Build, string Machine, int Intensity, IReadOnlyList<LiveResult> Results);

/// <summary>
/// Runs the shared workloads in-process with <see cref="Measure"/> on the runtime hosting the dashboard (.NET 11).
/// These are quick, single-runtime measurements: no process isolation, no statistics, other requests compete for
/// the CPU. BenchmarkDotNet results (cross-runtime, statistically sound) are a separate section of the page.
/// </summary>
public sealed class LivePerformanceRunner
{
    public const int MinIntensity = 1, MaxIntensity = 5;

    private readonly Lazy<IReadOnlyList<LiveGroup>> _groups = new(CreateGroups);

    public IReadOnlyList<LiveGroup> Groups => _groups.Value;

    public LiveGroup GetGroup(string id) =>
        Groups.FirstOrDefault(g => g.Id == id) ?? throw new KeyNotFoundException($"Unknown workload group '{id}'.");

    /// <summary>Runs the given groups one after another on a thread-pool thread so the UI stays responsive.</summary>
    public async Task<LiveRun> RunAsync(IEnumerable<string> groupIds, int intensity, CancellationToken cancellationToken)
    {
        intensity = Math.Clamp(intensity, MinIntensity, MaxIntensity);
        var groups = groupIds.Distinct().Select(GetGroup).ToList();
        if (groups.Count == 0) throw new ArgumentException("Select at least one workload group.", nameof(groupIds));

        var started = DateTimeOffset.UtcNow;
        var results = new List<LiveResult>();
        foreach (var group in groups)
        {
            cancellationToken.ThrowIfCancellationRequested();
            results.AddRange(await Task.Run(() => RunGroupAsync(group, intensity, cancellationToken), cancellationToken).ConfigureAwait(false));
        }
        return new LiveRun(Guid.NewGuid().ToString("N")[..12], started, RuntimeInformation.FrameworkDescription, BuildInfo.Workloads,
            $"{Environment.MachineName} · {RuntimeInformation.OSDescription} · {Environment.ProcessorCount} logical CPUs", intensity, results);
    }

    internal static async Task<IReadOnlyList<LiveResult>> RunGroupAsync(LiveGroup group, int intensity, CancellationToken cancellationToken)
    {
        var iterations = group.BaseIterations * intensity;
        var measured = new List<(LiveVariant Variant, Measurement Measurement, long Checksum)>();
        foreach (var variant in group.Variants)
        {
            var checksum = await variant.Run(cancellationToken).ConfigureAwait(false);
            long sink = 0;
            var m = variant.IsAsync
                ? await Measure.RunAsync(variant.Name, iterations, async () => sink += await variant.Run(cancellationToken).ConfigureAwait(false), cancellationToken).ConfigureAwait(false)
                // Synchronous variants complete synchronously, so the ValueTask is already finished here.
                : Measure.Run(variant.Name, iterations, () => sink += variant.Run(cancellationToken).GetAwaiter().GetResult(), cancellationToken);
            GC.KeepAlive(sink);
            measured.Add((variant, m, checksum));
        }
        var slowest = measured.Max(x => x.Measurement.MeanMicroseconds);
        return measured.Select(x => new LiveResult(group.Id, x.Variant.Name, x.Measurement.Iterations, x.Measurement.MeanMicroseconds,
            x.Measurement.AllocatedBytesPerOp, x.Measurement.OpsPerSecond, x.Measurement.Gen0Collections,
            x.Measurement.MeanMicroseconds > 0 ? slowest / x.Measurement.MeanMicroseconds : 1, x.Checksum, x.Variant.ChecksumLabel)).ToList();
    }

    private static ValueTask<long> Sync(long value) => ValueTask.FromResult(value);

    private static IReadOnlyList<LiveGroup> CreateGroups()
    {
        // Same inputs and sizes as the BenchmarkDotNet suites (src/DotNet11Lab.Benchmarks/Suites).
        var csv = WorkloadData.CreateCsvNumbers(1_000);
        var ledger = WorkloadData.CreateLedger(10_000);
        var orders = WorkloadData.CreateOrders(200);
        var ordersJson = JsonWorkloads.SerializeWithSourceGen(orders);
        var integers = WorkloadData.CreateIntegers(100_000);
        var (map, frozen, probes) = WorkloadData.CreateLookup(1_000, 10_000);
        var payload = WorkloadData.CreateLedger(12_000);

        return
        [
            new("parse", "Parse CSV: Split vs spans", "Sum 1,000 comma-separated integers.", "Text", 1_000,
            [
                new("string.Split", "Perf.ParseSplit", false, _ => Sync(TextWorkloads.SumWithSplit(csv)), "sum"),
                new("Span Split + ranges", "Perf.ParseSpan", false, _ => Sync(TextWorkloads.SumWithSpans(csv)), "sum"),
            ]),
            new("build", "Build text: += vs StringBuilder", "Build a 300-line report.", "Text", 200,
            [
                new("string +=", "Perf.BuildConcat", false, _ => Sync(TextWorkloads.BuildWithConcat(300)), "length"),
                new("StringBuilder", "Perf.BuildStringBuilder", false, _ => Sync(TextWorkloads.BuildWithStringBuilder(300)), "length"),
            ]),
            new("streams", "Stream parsing: StreamReader vs PipeReader", "Sum the amount column of a 10,000-line ledger (~210 KB).", "Streams", 20,
            [
                new("StreamReader + Split", "Perf.StreamReader", true, async ct => await StreamWorkloads.SumWithStreamReaderAsync(ledger, ct).ConfigureAwait(false), "total cents"),
                new("PipeReader + UTF-8 spans", "Perf.PipeReader", true, async ct => await StreamWorkloads.SumWithPipeReaderAsync(ledger, ct).ConfigureAwait(false), "total cents"),
            ]),
            new("json-serialize", "JSON serialize: reflection vs source generation", "Serialize 200 orders with nested lines.", "Json", 50,
            [
                new("Reflection metadata", "Perf.JsonReflection", false, _ => Sync(JsonWorkloads.SerializeWithReflection(orders).Length), "chars"),
                new("Source-generated", "Perf.JsonSourceGen", false, _ => Sync(JsonWorkloads.SerializeWithSourceGen(orders).Length), "chars"),
            ]),
            new("json-deserialize", "JSON deserialize: reflection vs source generation", "Deserialize the same 200 orders.", "Json", 50,
            [
                new("Reflection metadata", "Perf.JsonReflection", false, _ => Sync(JsonWorkloads.DeserializeWithReflection(ordersJson).Count), "orders"),
                new("Source-generated", "Perf.JsonSourceGen", false, _ => Sync(JsonWorkloads.DeserializeWithSourceGen(ordersJson).Count), "orders"),
            ]),
            new("async", "Async returns: Task vs ValueTask", "10,000 calls to a method that completes synchronously.", "Async", 50,
            [
                new("Synchronous (no async)", "Perf.AsyncSync", false, _ => Sync(AsyncWorkloads.SumSynchronously(10_000)), "sum"),
                new("async Task<int>", "Perf.AsyncTask", true, async _ => await AsyncWorkloads.SumViaTaskAsync(10_000).ConfigureAwait(false), "sum"),
                new("async ValueTask<int>", "Perf.AsyncValueTask", true, async _ => await AsyncWorkloads.SumViaValueTaskAsync(10_000).ConfigureAwait(false), "sum"),
            ]),
            new("linq", "Collections: LINQ chain vs loop", "Where/Select/Sum over 100,000 integers.", "Collections", 50,
            [
                new("LINQ Where/Select/Sum", "Perf.Linq", false, _ => Sync(CollectionWorkloads.SumWithLinq(integers)), "sum"),
                new("foreach loop", "Perf.Loop", false, _ => Sync(CollectionWorkloads.SumWithLoop(integers)), "sum"),
            ]),
            new("lookup", "Lookups: Dictionary vs FrozenDictionary", "10,000 string-key lookups in a 1,000-entry map.", "Collections", 100,
            [
                new("Dictionary<string,int>", "Perf.Lookup", false, _ => Sync(CollectionWorkloads.LookupAll(map, probes)), "hit sum"),
                new("FrozenDictionary<string,int>", "Perf.Lookup", false, _ => Sync(CollectionWorkloads.LookupAll(frozen, probes)), "hit sum"),
            ]),
            new("compression", "Compression: GZip vs Brotli vs Zstandard", "Compress ~250 KB of ledger text at CompressionLevel.Optimal. Zstandard is in-box from .NET 11.", "Compression", 3,
            [
                new("GZip", "Perf.Compress", false, _ => Sync(CompressionWorkloads.CompressedLength(payload, CompressionAlgorithm.GZip, CompressionLevel.Optimal)), "compressed bytes"),
                new("Brotli", "Perf.Compress", false, _ => Sync(CompressionWorkloads.CompressedLength(payload, CompressionAlgorithm.Brotli, CompressionLevel.Optimal)), "compressed bytes"),
                new("Zstandard", "Perf.Compress", false, _ => Sync(CompressionWorkloads.CompressedLength(payload, CompressionAlgorithm.Zstandard, CompressionLevel.Optimal)), "compressed bytes"),
            ]),
        ];
    }
}
