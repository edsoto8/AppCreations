namespace DotNet11Lab.Core.Labs.Performance;

/// <summary>Reads <c>results/benchmarks/latest.json</c> written by DotNet11Lab.Benchmarks.</summary>
public sealed class BenchmarkResultsStore(LabResultsLocator locator)
{
    /// <summary>Results files are small; anything bigger is not ours.</summary>
    public const long MaxFileBytes = 4 * 1024 * 1024;

    public const string ProduceCommand =
        "dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks";

    public string Path => locator.BenchmarkResultsPath;

    public async Task<ResultsLoad<BenchmarkResultsFile>> LoadAsync(CancellationToken cancellationToken = default)
    {
        var info = new FileInfo(Path);
        if (!info.Exists) return new(ResultsFileStatus.Missing, Path, null, null, null);
        if (info.Length > MaxFileBytes)
            return new(ResultsFileStatus.Invalid, Path, null, $"File is {info.Length:N0} bytes; the limit is {MaxFileBytes:N0}.", info.LastWriteTimeUtc);
        try
        {
            var json = await File.ReadAllTextAsync(Path, cancellationToken).ConfigureAwait(false);
            return new(ResultsFileStatus.Loaded, Path, BenchmarkResultsJson.Deserialize(json), null, info.LastWriteTimeUtc);
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            return new(ResultsFileStatus.Invalid, Path, null, ex.Message, info.LastWriteTimeUtc);
        }
    }
}
