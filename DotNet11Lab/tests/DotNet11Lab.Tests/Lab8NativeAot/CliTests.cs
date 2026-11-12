using System.Diagnostics;
using System.Text;
using System.Text.Json;
using DotNet11Lab.Cli;

namespace DotNet11Lab.Tests.Lab8NativeAot;

public class CliTests
{
    private static async Task<(int Exit, string Out, string Err)> RunAsync(string stdin, params string[] args)
    {
        var stdout = new StringWriter();
        var stderr = new StringWriter();
        var exit = await new CliApp(new StringReader(stdin), stdout, stderr)
            .RunAsync(args, DateTime.UtcNow, Stopwatch.GetTimestamp(), TestContext.Current.CancellationToken);
        return (exit, stdout.ToString(), stderr.ToString());
    }

    private static string Jsonl(IEnumerable<Transaction> transactions) =>
        string.Join('\n', transactions.Select(t => JsonSerializer.Serialize(t, CliJsonContext.Default.Transaction)));

    [Fact]
    public void Generation_is_deterministic_and_capped()
    {
        var a = GenerateCommand.Generate(100, seed: 7).ToList();
        var b = GenerateCommand.Generate(100, seed: 7).ToList();

        Assert.Equal(100, a.Count);
        Assert.Equal(a, b);
        Assert.NotEqual(a, GenerateCommand.Generate(100, seed: 8).ToList());
        Assert.Throws<ArgumentOutOfRangeException>(() => GenerateCommand.Generate(GenerateCommand.MaxCount + 1, 1).First());
    }

    [Fact]
    public async Task Stats_summarise_per_currency_and_count_invalid_lines()
    {
        var transactions = GenerateCommand.Generate(2_000, seed: 3).ToList();
        var input = Jsonl(transactions) + "\n\n{not json}\n{\"id\":\"x\",\"amount\":1}\n";

        var report = await StatsCommand.ComputeAsync(new StringReader(input), TestContext.Current.CancellationToken);

        Assert.Equal(2_000, report.Transactions);
        Assert.Equal(2, report.InvalidLines);
        Assert.Equal(2, report.Errors.Count);
        foreach (var group in transactions.GroupBy(t => t.Currency))
        {
            var summary = report.ByCurrency.Single(c => c.Currency == group.Key);
            Assert.Equal(group.Count(), summary.Count);
            Assert.Equal(group.Sum(t => t.Amount), summary.Total);
            Assert.Equal(group.Min(t => t.Amount), summary.Min);
            Assert.Equal(group.Max(t => t.Amount), summary.Max);
        }
        Assert.Equal(transactions.Min(t => t.Timestamp), report.First);
        Assert.True(report.TopCategories.Count <= StatsCommand.TopCategoryCount);
    }

    [Fact]
    public async Task Gen_then_stats_through_the_command_line()
    {
        var gen = await RunAsync("", "gen", "250", "--seed", "11");
        Assert.Equal(CliApp.Ok, gen.Exit);
        Assert.Equal(250, gen.Out.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length);

        var stats = await RunAsync(gen.Out, "stats", "-", "--json");
        Assert.Equal(CliApp.Ok, stats.Exit);
        var report = JsonSerializer.Deserialize(stats.Out, CliJsonContext.Default.StatsReport)!;
        Assert.Equal(250, report.Transactions);
        Assert.Equal(0, report.InvalidLines);

        var text = await RunAsync(gen.Out, "stats", "-");
        Assert.Contains("Transactions: 250", text.Out, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Files_round_trip_through_zstandard()
    {
        var ct = TestContext.Current.CancellationToken;
        var original = Encoding.UTF8.GetBytes(Jsonl(GenerateCommand.Generate(3_000, 5)));
        using var compressed = new MemoryStream();
        var c = await CompressCommand.CompressAsync(new MemoryStream(original), compressed, quality: 9, ct);
        Assert.Equal(original.Length, c.InputBytes);
        Assert.InRange(c.OutputBytes, 1, original.Length / 3);

        compressed.Position = 0;
        using var restored = new MemoryStream();
        var d = await CompressCommand.DecompressAsync(compressed, restored, ct);
        Assert.Equal(original.Length, d.OutputBytes);
        Assert.Equal(original, restored.ToArray());

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            CompressCommand.CompressAsync(new MemoryStream(original), new MemoryStream(), CompressCommand.MaxQuality + 1, ct));
    }

    [Fact]
    public async Task Compress_command_works_on_files()
    {
        using var dir = new Lab5Performance.TempDirectory();
        var input = Path.Combine(dir.Path, "tx.jsonl");
        await File.WriteAllTextAsync(input, Jsonl(GenerateCommand.Generate(500, 1)), TestContext.Current.CancellationToken);

        var compress = await RunAsync("", "compress", input, Path.Combine(dir.Path, "tx.zst"), "--quality", "3");
        var decompress = await RunAsync("", "decompress", Path.Combine(dir.Path, "tx.zst"), Path.Combine(dir.Path, "back.jsonl"));
        var same = await RunAsync("", "compress", input, input);

        Assert.Equal(CliApp.Ok, compress.Exit);
        Assert.Equal(CliApp.Ok, decompress.Exit);
        Assert.Equal(await File.ReadAllTextAsync(input, TestContext.Current.CancellationToken),
            await File.ReadAllTextAsync(Path.Combine(dir.Path, "back.jsonl"), TestContext.Current.CancellationToken));
        Assert.Equal(CliApp.UsageError, same.Exit);
    }

    [Fact]
    public async Task Startup_probe_prints_one_json_line()
    {
        var (exit, output, _) = await RunAsync("", "--startup-probe");

        Assert.Equal(CliApp.Ok, exit);
        var probe = JsonSerializer.Deserialize(output, CliJsonContext.Default.StartupProbeResult)!;
        Assert.True(probe.IsDynamicCodeSupported); // the test host is JIT-compiled; Native AOT reports false
        Assert.True(probe.PeakWorkingSetBytes >= probe.WorkingSetBytes / 2 && probe.WorkingSetBytes > 0);
        Assert.StartsWith(".NET 11", probe.Runtime, StringComparison.Ordinal);
        Assert.Single(output.Trim().Split('\n'));
    }

    [Theory]
    [InlineData(CliApp.UsageError)]
    [InlineData(CliApp.UsageError, "bogus")]
    [InlineData(CliApp.UsageError, "gen", "-5")]
    [InlineData(CliApp.UsageError, "gen", "99999999999")]
    [InlineData(CliApp.UsageError, "stats")]
    [InlineData(CliApp.UsageError, "compress", "only-one")]
    [InlineData(CliApp.Failure, "stats", "/definitely/not/here.jsonl")]
    [InlineData(CliApp.Ok, "--help")]
    public async Task Bad_input_returns_a_usage_or_failure_code(int expected, params string[] args) =>
        Assert.Equal(expected, (await RunAsync("", args)).Exit);

    [Fact]
    public void Cli_project_is_marked_aot_compatible()
    {
        var csproj = File.ReadAllText(Path.Combine(Infrastructure.SnippetReferenceTests.RepoRoot(), "src", "DotNet11Lab.Cli", "DotNet11Lab.Cli.csproj"));
        Assert.Contains("<IsAotCompatible>true</IsAotCompatible>", csproj, StringComparison.Ordinal);
        Assert.Contains("<AssemblyName>dotnet11lab</AssemblyName>", csproj, StringComparison.Ordinal);
    }
}
