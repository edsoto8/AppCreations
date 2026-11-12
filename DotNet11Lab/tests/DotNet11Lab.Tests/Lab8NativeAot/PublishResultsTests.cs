using DotNet11Lab.Core.Labs.NativeAot;
using DotNet11Lab.Core.Labs.Performance;
using DotNet11Lab.Tests.Lab5Performance;

namespace DotNet11Lab.Tests.Lab8NativeAot;

public class PublishResultsTests
{
    // Shape written by scripts/publish-compare.sh (values are fixture data, not measurements).
    private const string Fixture = """
        {
          "schemaVersion": 1,
          "generatedUtc": "2026-11-01T10:00:00Z",
          "preliminary": true,
          "note": "fixture",
          "machine": {"os": "Linux", "processor": "Test CPU", "logicalCores": 4, "rid": "linux-x64", "sdk": "11.0.100"},
          "settings": {"configuration": "Release", "startupRuns": 10, "selfContainedVariant": "single-file, untrimmed"},
          "modes": [
            {"mode":"framework-dependent","publishCommand":"dotnet publish ...","succeeded":true,"totalSizeBytes":1000,"fileCount":4,"executable":"dotnet11lab","executableSizeBytes":100,
             "startupWallMs":{"median":50.5,"min":40.0,"max":60.25},"startupProbeMs":{"median":20,"min":10,"max":30},"peakWorkingSetBytes":3000,"maxRssBytes":null,"isDynamicCodeSupported":true,"runtime":".NET 11.0.0"},
            {"mode":"native-aot","publishCommand":"dotnet publish ... -p:PublishAot=true","succeeded":true,"totalSizeBytes":2000,"fileCount":1,"executable":"dotnet11lab","executableSizeBytes":2000,
             "startupWallMs":{"median":5,"min":4,"max":6},"startupProbeMs":null,"peakWorkingSetBytes":1000,"maxRssBytes":1200,"isDynamicCodeSupported":false,"runtime":".NET 11.0.0"},
            {"mode":"self-contained","publishCommand":"dotnet publish ...","succeeded":false,"error":"dotnet publish failed: error NETSDK0000"}
          ]
        }
        """;

    [Fact]
    public void Fixture_parses_including_failed_modes_and_nulls()
    {
        var file = PublishResultsJson.Deserialize(Fixture);

        Assert.True(file.Preliminary);
        Assert.Equal("linux-x64", file.Machine.Rid);
        Assert.Equal(10, file.Settings.StartupRuns);
        Assert.Equal(3, file.Modes.Count);
        var fd = file.Modes[0];
        Assert.Equal(50.5, fd.StartupWallMs!.Median);
        Assert.Null(fd.MaxRssBytes);
        var aot = file.Modes[1];
        Assert.False(aot.IsDynamicCodeSupported);
        Assert.Null(aot.StartupProbeMs);
        Assert.Equal(1200, aot.MaxRssBytes);
        var failed = file.Modes[2];
        Assert.False(failed.Succeeded);
        Assert.Null(failed.TotalSizeBytes);
        Assert.Contains("NETSDK0000", failed.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void Round_trips_and_rejects_bad_schema()
    {
        var file = PublishResultsJson.Deserialize(Fixture);
        Assert.Equal(file.Modes.Count, PublishResultsJson.Deserialize(PublishResultsJson.Serialize(file)).Modes.Count);
        Assert.Throws<InvalidDataException>(() => PublishResultsJson.Deserialize(Fixture.Replace("\"schemaVersion\": 1", "\"schemaVersion\": 2", StringComparison.Ordinal)));
        Assert.Throws<InvalidDataException>(() => PublishResultsJson.Deserialize("[]"));
    }

    [Fact]
    public async Task Store_reads_the_file_from_the_results_folder()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var store = new PublishResultsStore(new LabResultsLocator(dir.Path, dir.Path));
        Assert.Equal(ResultsFileStatus.Missing, (await store.LoadAsync(ct)).Status);

        Directory.CreateDirectory(Path.GetDirectoryName(store.Path)!);
        await File.WriteAllTextAsync(store.Path, Fixture, ct);
        var loaded = await store.LoadAsync(ct);

        Assert.Equal(ResultsFileStatus.Loaded, loaded.Status);
        Assert.Equal(3, loaded.File!.Modes.Count);
    }

    [Fact]
    public void Committed_results_files_parse_if_present()
    {
        // Guards the files the scripts produced in this repository (preliminary or final) against schema drift.
        var root = Infrastructure.SnippetReferenceTests.RepoRoot();
        var publish = Path.Combine(root, "results", "publish", "latest.json");
        if (File.Exists(publish)) Assert.NotEmpty(PublishResultsJson.Deserialize(File.ReadAllText(publish)).Modes);
        var benchmarks = Path.Combine(root, "results", "benchmarks", "latest.json");
        if (File.Exists(benchmarks)) Assert.NotEmpty(BenchmarkResultsJson.Deserialize(File.ReadAllText(benchmarks)).Results);
    }

    [Fact]
    public void Process_snapshot_describes_this_jit_process()
    {
        var s = ProcessSnapshot.Capture();

        Assert.True(s.IsDynamicCodeSupported);
        Assert.True(s.WorkingSetBytes > 0);
        Assert.True(s.JitCompiledMethods > 0);
        Assert.StartsWith(".NET 11", s.FrameworkDescription, StringComparison.Ordinal);
    }
}
