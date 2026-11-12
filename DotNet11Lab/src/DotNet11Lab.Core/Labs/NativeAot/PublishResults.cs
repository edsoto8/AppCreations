using System.Text.Json;
using System.Text.Json.Serialization;
using DotNet11Lab.Core.Labs.Performance;

namespace DotNet11Lab.Core.Labs.NativeAot;

// Schema of results/publish/latest.json, written by scripts/publish-compare.sh and scripts/publish-compare.ps1.

public sealed record PublishMachineInfo(string Os, string Processor, int LogicalCores, string Rid, string Sdk);

public sealed record PublishSettings(string Configuration, int StartupRuns, string SelfContainedVariant);

/// <summary>Summary statistics in milliseconds over the measured runs.</summary>
public sealed record TimingStats(double Median, double Min, double Max);

public sealed record PublishModeResult(
    /// <summary><c>framework-dependent</c>, <c>self-contained</c> or <c>native-aot</c>.</summary>
    string Mode,
    string PublishCommand,
    bool Succeeded,
    string? Error,
    long? TotalSizeBytes,
    int? FileCount,
    string? Executable,
    long? ExecutableSizeBytes,
    /// <summary>Wall-clock launch-to-exit of <c>dotnet11lab --startup-probe</c>, timed by the script.</summary>
    TimingStats? StartupWallMs,
    /// <summary>Process start time to Main as reported by the probe (OS clock; coarse, ~10 ms on Linux).</summary>
    TimingStats? StartupProbeMs,
    /// <summary>Median peak working set reported by the probe (<c>Process.PeakWorkingSet64</c>).</summary>
    long? PeakWorkingSetBytes,
    /// <summary>Median max RSS from <c>/usr/bin/time -v</c>, when available (Linux only).</summary>
    long? MaxRssBytes,
    bool? IsDynamicCodeSupported,
    string? Runtime);

public sealed record PublishResultsFile(
    int SchemaVersion,
    DateTimeOffset GeneratedUtc,
    bool Preliminary,
    string? Note,
    PublishMachineInfo Machine,
    PublishSettings Settings,
    IReadOnlyList<PublishModeResult> Modes)
{
    public const int CurrentSchemaVersion = 1;
}

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(PublishResultsFile))]
internal sealed partial class PublishResultsJsonContext : JsonSerializerContext;

public static class PublishResultsJson
{
    public static string Serialize(PublishResultsFile file) => JsonSerializer.Serialize(file, PublishResultsJsonContext.Default.PublishResultsFile);

    public static PublishResultsFile Deserialize(string json)
    {
        PublishResultsFile? file;
        try
        {
            file = JsonSerializer.Deserialize(json, PublishResultsJsonContext.Default.PublishResultsFile);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"The publish results file is not valid JSON: {ex.Message}", ex);
        }
        if (file is null) throw new InvalidDataException("The publish results file is empty.");
        if (file.SchemaVersion != PublishResultsFile.CurrentSchemaVersion)
            throw new InvalidDataException($"Unsupported schemaVersion {file.SchemaVersion} (expected {PublishResultsFile.CurrentSchemaVersion}).");
        if (file.Modes is null || file.Machine is null || file.Settings is null)
            throw new InvalidDataException("The publish results file is missing 'modes', 'machine' or 'settings'.");
        return file;
    }
}

/// <summary>Reads <c>results/publish/latest.json</c>.</summary>
public sealed class PublishResultsStore(LabResultsLocator locator)
{
    public const long MaxFileBytes = 1024 * 1024;
    public const string ProduceCommandUnix = "./scripts/publish-compare.sh";
    public const string ProduceCommandWindows = "pwsh ./scripts/publish-compare.ps1";

    public string Path => locator.PublishResultsPath;

    public async Task<ResultsLoad<PublishResultsFile>> LoadAsync(CancellationToken cancellationToken = default)
    {
        var info = new FileInfo(Path);
        if (!info.Exists) return new(ResultsFileStatus.Missing, Path, null, null, null);
        if (info.Length > MaxFileBytes)
            return new(ResultsFileStatus.Invalid, Path, null, $"File is {info.Length:N0} bytes; the limit is {MaxFileBytes:N0}.", info.LastWriteTimeUtc);
        try
        {
            var json = await File.ReadAllTextAsync(Path, cancellationToken).ConfigureAwait(false);
            return new(ResultsFileStatus.Loaded, Path, PublishResultsJson.Deserialize(json), null, info.LastWriteTimeUtc);
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            return new(ResultsFileStatus.Invalid, Path, null, ex.Message, info.LastWriteTimeUtc);
        }
    }
}
