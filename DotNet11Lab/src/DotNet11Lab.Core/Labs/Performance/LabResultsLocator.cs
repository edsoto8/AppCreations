namespace DotNet11Lab.Core.Labs.Performance;

/// <summary>
/// Finds the <c>results/</c> folder that the benchmark runner and the publish-compare scripts write to
/// (<c>results/benchmarks/latest.json</c>, <c>results/publish/latest.json</c>). Shared by Labs 5 and 8.
/// </summary>
/// <remarks>
/// Order: the configured <c>LabResults:Directory</c> (relative paths resolve against the content root), then a
/// <c>results</c> folder next to <c>DotNet11Lab.slnx</c> found by walking up from the content root or the binaries,
/// then <c>&lt;content root&gt;/results</c>.
/// </remarks>
public sealed class LabResultsLocator(string? configuredDirectory, string contentRoot)
{
    public const string ConfigurationKey = "LabResults:Directory";

    public string ResultsDirectory { get; } = Resolve(configuredDirectory, contentRoot);

    public string BenchmarkResultsPath => Path.Combine(ResultsDirectory, "benchmarks", "latest.json");

    public string PublishResultsPath => Path.Combine(ResultsDirectory, "publish", "latest.json");

    private static string Resolve(string? configured, string contentRoot)
    {
        if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured, contentRoot);
        foreach (var start in new[] { contentRoot, AppContext.BaseDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "DotNet11Lab.slnx"))) return Path.Combine(dir.FullName, "results");
            }
        }
        return Path.Combine(contentRoot, "results");
    }
}

public enum ResultsFileStatus
{
    Missing,
    Invalid,
    Loaded,
}

/// <summary>Outcome of reading a results file: the file, or why there is none. Never a made-up default.</summary>
public sealed record ResultsLoad<T>(ResultsFileStatus Status, string Path, T? File, string? Error, DateTimeOffset? LastWriteUtc)
    where T : class;
