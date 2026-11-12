using BenchmarkDotNet.Reports;
using DotNet11Lab.Core.Labs.Performance;

namespace DotNet11Lab.Benchmarks;

/// <summary>
/// Converts BenchmarkDotNet summaries into the compact <c>results/benchmarks/latest.json</c> the dashboard reads.
/// BenchmarkDotNet's own <c>*-report-full.json</c> is still exported, but it carries neither the job's runtime nor
/// the benchmark categories as fields, so the compact file is built from the in-memory <see cref="Summary"/> instead.
/// </summary>
internal static class SummaryConverter
{
    public static BenchmarkResultsFile Convert(IReadOnlyList<Summary> summaries, bool preliminary, string mode, string? note)
    {
        ArgumentOutOfRangeException.ThrowIfZero(summaries.Count);
        var host = summaries[0].HostEnvironmentInfo;
        var cpu = host.Cpu.Value;
        var machine = new BenchmarkMachineInfo(
            Os: host.Os.Value?.ToString() ?? Environment.OSVersion.ToString(),
            Processor: cpu?.ProcessorName ?? "unknown",
            PhysicalCores: cpu?.PhysicalCoreCount,
            LogicalCores: cpu?.LogicalCoreCount,
            Architecture: host.Architecture,
            HostRuntime: host.RuntimeVersion,
            DotNetSdk: host.DotNetSdkVersion.Value,
            BenchmarkDotNetVersion: host.BenchmarkDotNetVersion);

        var entries = new List<BenchmarkResultEntry>();
        foreach (var report in summaries.SelectMany(s => s.Reports))
        {
            var stats = report.ResultStatistics;
            if (!report.Success || stats is null) continue;
            var bc = report.BenchmarkCase;
            var gc = report.GcStats;
            entries.Add(new BenchmarkResultEntry(
                Category: bc.Descriptor.Categories.FirstOrDefault() ?? bc.Descriptor.Type.Name,
                Type: bc.Descriptor.Type.Name,
                Method: bc.Descriptor.WorkloadMethod.Name,
                Parameters: bc.Parameters.DisplayInfo.Trim('[', ']'), // "[Depth=10]" -> "Depth=10"
                Runtime: bc.Job.Environment.Runtime?.Name ?? host.RuntimeVersion,
                RuntimeVersion: report.GetRuntimeInfo(),
                IsBaseline: bc.Job.Meta.Baseline,
                MeanNs: stats.Mean,
                StdDevNs: stats.StandardDeviation,
                MedianNs: stats.Median,
                AllocatedBytes: gc.GetBytesAllocatedPerOperation(bc),
                Gen0Per1000Ops: gc.TotalOperations > 0 ? gc.Gen0Collections * 1000d / gc.TotalOperations : null));
        }

        return new BenchmarkResultsFile(
            BenchmarkResultsFile.CurrentSchemaVersion,
            DateTimeOffset.UtcNow,
            preliminary,
            mode,
            note,
            machine,
            BenchmarkResultsJson.WithRatios(entries));
    }
}
