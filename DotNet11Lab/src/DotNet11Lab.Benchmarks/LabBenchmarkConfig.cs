using BenchmarkDotNet.Columns;
using BenchmarkDotNet.Configs;
using BenchmarkDotNet.Diagnosers;
using BenchmarkDotNet.Environments;
using BenchmarkDotNet.Exporters;
using BenchmarkDotNet.Exporters.Json;
using BenchmarkDotNet.Jobs;

namespace DotNet11Lab.Benchmarks;

/// <summary>
/// One job per runtime. The .NET 10 job is the baseline, so BenchmarkDotNet's Ratio column (and latest.json) reads
/// "time on .NET 11 / time on .NET 10" for each benchmark. BenchmarkDotNet builds a separate child process per job
/// (net10.0 and net11.0 builds of this project), so each runtime executes its own JIT/GC.
/// </summary>
public static class LabBenchmarkConfig
{
    public const string Net10JobId = ".NET 10";
    public const string Net11JobId = ".NET 11";

    public static Runtime Net10 => CoreRuntime.Core10_0;

    /// <summary>BenchmarkDotNet 0.15.8 has no <c>CoreRuntime.Core11_0</c> member (it stops at Core10_0), so .NET 11 is created by moniker.</summary>
    public static Runtime Net11 { get; } = CoreRuntime.CreateForNewVersion("net11.0", ".NET 11.0");

    public static IConfig Create(string artifactsPath, bool quick, bool includeNet10)
    {
        var job = quick
            // Smoke-test job: enough to prove the pipeline works end to end. Its numbers are not meaningful.
            ? Job.ShortRun.WithWarmupCount(1).WithIterationCount(3)
            // MediumRun (2 launches x 15 iterations after 10 warm-ups) rather than Job.Default: on noisy, shared VMs the
            // default job's adaptive iteration count hits its 100-iteration cap on almost every benchmark, stretching
            // the suite past two hours without improving the estimate. MediumRun is a fixed, documented budget and
            // BenchmarkDotNet still reports error and standard deviation for every result.
            : Job.MediumRun;

        var config = ManualConfig.CreateMinimumViable()
            .AddDiagnoser(MemoryDiagnoser.Default)
            .AddColumn(CategoriesColumn.Default)
            .AddExporter(JsonExporter.Full, MarkdownExporter.GitHub)
            .WithArtifactsPath(artifactsPath)
            // DisableParallelBuild: BenchmarkDotNet 0.15.8 calls RuntimeMoniker.GetRuntimeVersion() while partitioning
            // parallel builds, which throws for the unrecognized .NET 11 moniker; sequential builds skip that check.
            .WithOptions(ConfigOptions.JoinSummary | ConfigOptions.DisableLogFile | ConfigOptions.DisableParallelBuild);

        if (includeNet10)
        {
            config.AddJob(job.WithRuntime(Net10).WithId(Net10JobId).AsBaseline());
        }
        config.AddJob(job.WithRuntime(Net11).WithToolchain(Net11Toolchain.Instance).WithId(Net11JobId));
        return config;
    }
}
