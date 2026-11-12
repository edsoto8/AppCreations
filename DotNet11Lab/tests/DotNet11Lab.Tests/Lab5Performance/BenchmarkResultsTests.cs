using DotNet11Lab.Core.Labs.Performance;

namespace DotNet11Lab.Tests.Lab5Performance;

public class BenchmarkResultsTests
{
    // Shape written by DotNet11Lab.Benchmarks (values are fixture data, not measurements).
    internal const string Fixture = """
        {
          "schemaVersion": 1,
          "generatedUtc": "2026-11-01T10:00:00+00:00",
          "preliminary": false,
          "mode": "full",
          "note": "fixture",
          "machine": {
            "os": "Linux Test", "processor": "Test CPU", "physicalCores": 8, "logicalCores": 16,
            "architecture": "X64", "hostRuntime": ".NET 11.0.0", "dotNetSdk": "11.0.100", "benchmarkDotNetVersion": "0.15.8"
          },
          "results": [
            { "category": "Text", "type": "TextBenchmarks", "method": "ParseWithSplit", "parameters": "", "runtime": ".NET 10.0",
              "isBaseline": true, "meanNs": 200, "allocatedBytes": 4000 },
            { "category": "Text", "type": "TextBenchmarks", "method": "ParseWithSplit", "parameters": "", "runtime": ".NET 11.0",
              "isBaseline": false, "meanNs": 150, "allocatedBytes": 2000 },
            { "category": "RuntimeAsync", "type": "RuntimeAsyncBenchmarks", "method": "ChainSync_Classic", "parameters": "Depth=10", "runtime": ".NET 11.0",
              "isBaseline": false, "meanNs": 100, "allocatedBytes": 200 },
            { "category": "RuntimeAsync", "type": "RuntimeAsyncBenchmarks", "method": "ChainSync_RuntimeAsync", "parameters": "Depth=10", "runtime": ".NET 11.0",
              "isBaseline": false, "meanNs": 50, "allocatedBytes": 50 },
            { "category": "Compression", "type": "ZstandardBenchmarks", "method": "ZstandardOptimal", "parameters": "", "runtime": ".NET 11.0",
              "isBaseline": false, "meanNs": 1000000, "allocatedBytes": 0 }
          ]
        }
        """;

    [Fact]
    public void Fixture_parses_with_machine_info_and_results()
    {
        var file = BenchmarkResultsJson.Deserialize(Fixture);

        Assert.Equal(1, file.SchemaVersion);
        Assert.False(file.Preliminary);
        Assert.Equal("Test CPU", file.Machine.Processor);
        Assert.Equal(16, file.Machine.LogicalCores);
        Assert.Equal(5, file.Results.Count);
        Assert.Equal("TextBenchmarks.ParseWithSplit", file.Results[0].Key);
        Assert.Equal("RuntimeAsyncBenchmarks.ChainSync_Classic(Depth=10)", file.Results[2].Key);
    }

    [Fact]
    public void Ratios_use_the_baseline_runtime_or_the_classic_twin()
    {
        var withRatios = BenchmarkResultsJson.WithRatios(BenchmarkResultsJson.Deserialize(Fixture).Results);

        var net10 = withRatios.Single(r => r.Method == "ParseWithSplit" && r.Runtime == ".NET 10.0");
        var net11 = withRatios.Single(r => r.Method == "ParseWithSplit" && r.Runtime == ".NET 11.0");
        Assert.Equal(1.0, net10.Ratio);
        Assert.Equal(0.75, net11.Ratio);
        Assert.Equal(0.5, net11.AllocatedRatio);

        Assert.Equal(1.0, withRatios.Single(r => r.Method == "ChainSync_Classic").Ratio);
        var ra = withRatios.Single(r => r.Method == "ChainSync_RuntimeAsync");
        Assert.Equal(0.5, ra.Ratio);
        Assert.Equal(0.25, ra.AllocatedRatio);

        Assert.Null(withRatios.Single(r => r.Method == "ZstandardOptimal").Ratio);
    }

    [Fact]
    public void Serialize_round_trips_and_markdown_lists_every_result()
    {
        var file = BenchmarkResultsJson.Deserialize(Fixture) with { Preliminary = true };

        var again = BenchmarkResultsJson.Deserialize(BenchmarkResultsJson.Serialize(file));
        var markdown = BenchmarkResultsJson.ToMarkdown(again);

        Assert.True(again.Preliminary);
        Assert.Equal(file.Results.Count, again.Results.Count);
        Assert.Contains("PRELIMINARY", markdown, StringComparison.Ordinal);
        Assert.Equal(file.Results.Count, markdown.Split('\n').Count(l => l.StartsWith("| ", StringComparison.Ordinal) && !l.StartsWith("| Category", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"schemaVersion": 99, "generatedUtc": "2026-01-01T00:00:00Z", "preliminary": false, "mode": "x", "machine": {}, "results": []}""")]
    [InlineData("""{"schemaVersion": 1, "generatedUtc": "2026-01-01T00:00:00Z", "preliminary": false, "mode": "x"}""")]
    public void Invalid_files_are_rejected(string json) =>
        Assert.Throws<InvalidDataException>(() => BenchmarkResultsJson.Deserialize(json));

    [Fact]
    public async Task Store_reports_missing_invalid_and_loaded_files()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var store = new BenchmarkResultsStore(new LabResultsLocator(dir.Path, dir.Path));

        var missing = await store.LoadAsync(ct);
        Assert.Equal(ResultsFileStatus.Missing, missing.Status);
        Assert.Null(missing.File);

        Directory.CreateDirectory(Path.GetDirectoryName(store.Path)!);
        await File.WriteAllTextAsync(store.Path, "{ broken", ct);
        var invalid = await store.LoadAsync(ct);
        Assert.Equal(ResultsFileStatus.Invalid, invalid.Status);
        Assert.NotNull(invalid.Error);

        await File.WriteAllTextAsync(store.Path, Fixture, ct);
        var loaded = await store.LoadAsync(ct);
        Assert.Equal(ResultsFileStatus.Loaded, loaded.Status);
        Assert.Equal(5, loaded.File!.Results.Count);
    }

    [Fact]
    public void Locator_finds_the_results_folder_next_to_the_solution()
    {
        var root = Infrastructure.SnippetReferenceTests.RepoRoot();
        var nested = Path.Combine(root, "src", "DotNet11Lab.Web");

        var locator = new LabResultsLocator(configuredDirectory: null, nested);

        Assert.Equal(Path.Combine(root, "results"), locator.ResultsDirectory);
        Assert.Equal(Path.Combine(root, "results", "benchmarks", "latest.json"), locator.BenchmarkResultsPath);
        Assert.Equal(Path.Combine(root, "results", "publish", "latest.json"), locator.PublishResultsPath);
    }

    [Fact]
    public void Locator_resolves_a_relative_configured_directory_against_the_content_root()
    {
        var locator = new LabResultsLocator("custom/results", "/srv/app");
        Assert.Equal(Path.GetFullPath("/srv/app/custom/results"), locator.ResultsDirectory);
    }
}

/// <summary>A unique temporary directory deleted on dispose.</summary>
internal sealed class TempDirectory : IDisposable
{
    public string Path { get; } = Directory.CreateDirectory(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dotnet11lab-tests", Guid.NewGuid().ToString("N"))).FullName;

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
