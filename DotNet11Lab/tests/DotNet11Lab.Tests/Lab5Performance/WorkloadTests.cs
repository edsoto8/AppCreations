using System.IO.Compression;
using DotNet11Lab.Core.Labs.Performance;
using DotNet11Lab.Core.Labs.Performance.Workloads;

namespace DotNet11Lab.Tests.Lab5Performance;

/// <summary>Each pair of workloads must compute the same answer; only how they do it differs.</summary>
public class WorkloadTests
{
    [Fact]
    public void Parsing_variants_agree()
    {
        var csv = WorkloadData.CreateCsvNumbers(1_000);
        Assert.Equal(csv.Split(',').Sum(long.Parse), TextWorkloads.SumWithSpans(csv));
        Assert.Equal(TextWorkloads.SumWithSplit(csv), TextWorkloads.SumWithSpans(csv));
    }

    [Fact]
    public void String_building_variants_agree() =>
        Assert.Equal(TextWorkloads.BuildWithConcat(300), TextWorkloads.BuildWithStringBuilder(300));

    [Theory]
    [InlineData(1)]
    [InlineData(500)]
    [InlineData(10_000)]
    public async Task Stream_variants_match_the_independently_computed_total(int lines)
    {
        var ct = TestContext.Current.CancellationToken;
        var ledger = WorkloadData.CreateLedger(lines);
        var expected = WorkloadData.ExpectedLedgerTotal(lines);

        Assert.Equal(expected, await StreamWorkloads.SumWithStreamReaderAsync(ledger, ct));
        Assert.Equal(expected, await StreamWorkloads.SumWithPipeReaderAsync(ledger, ct));
    }

    [Fact]
    public async Task PipeReader_handles_a_last_line_without_newline()
    {
        var ledger = "1,ACC-001,100\n2,ACC-002,-40"u8.ToArray();
        Assert.Equal(60, await StreamWorkloads.SumWithPipeReaderAsync(ledger, TestContext.Current.CancellationToken));
    }

    [Fact]
    public void Json_variants_produce_identical_documents_and_objects()
    {
        var orders = WorkloadData.CreateOrders(50);
        var reflection = JsonWorkloads.SerializeWithReflection(orders);
        var sourceGen = JsonWorkloads.SerializeWithSourceGen(orders);

        Assert.Equal(reflection, sourceGen);
        var a = JsonWorkloads.DeserializeWithReflection(sourceGen);
        var b = JsonWorkloads.DeserializeWithSourceGen(sourceGen);
        Assert.Equal(orders.Count, a.Count);
        Assert.Equal(a.Select(o => (o.Id, o.Total, o.Lines.Count)), b.Select(o => (o.Id, o.Total, o.Lines.Count)));
    }

    [Fact]
    public async Task Async_variants_agree()
    {
        var expected = AsyncWorkloads.SumSynchronously(10_000);
        Assert.Equal(expected, await AsyncWorkloads.SumViaTaskAsync(10_000));
        Assert.Equal(expected, await AsyncWorkloads.SumViaValueTaskAsync(10_000));
    }

    [Fact]
    public void Collection_variants_agree()
    {
        var values = WorkloadData.CreateIntegers(10_000);
        Assert.Equal(CollectionWorkloads.SumWithLoop(values), CollectionWorkloads.SumWithLinq(values));

        var (map, frozen, probes) = WorkloadData.CreateLookup(1_000, 5_000);
        Assert.Equal(CollectionWorkloads.LookupAll(map, probes), CollectionWorkloads.LookupAll(frozen, probes));
        Assert.True(CollectionWorkloads.LookupAll(map, probes) > 0);
    }

    [Theory]
    [InlineData(CompressionAlgorithm.GZip)]
    [InlineData(CompressionAlgorithm.Brotli)]
    [InlineData(CompressionAlgorithm.Zstandard)]
    public void Every_codec_is_available_on_net11_and_compresses_text(CompressionAlgorithm algorithm)
    {
        var payload = WorkloadData.CreateLedger(2_000);
        Assert.True(CompressionWorkloads.IsSupported(algorithm));
        var size = CompressionWorkloads.CompressedLength(payload, algorithm, CompressionLevel.Fastest);
        Assert.InRange(size, 1, payload.Length * 3 / 4); // GZip Fastest reaches ~58% on this numeric text
    }

    [Fact]
    public async Task Live_runner_measures_every_variant_and_ranks_against_the_slowest()
    {
        var runner = new LivePerformanceRunner();
        var run = await runner.RunAsync(["parse", "async"], intensity: 1, TestContext.Current.CancellationToken);

        Assert.Equal(5, run.Results.Count);
        Assert.Contains(BuildInfo.Workloads, new[] { "Release", "Debug" });
        foreach (var group in run.Results.GroupBy(r => r.GroupId))
        {
            Assert.Single(group.Select(r => r.Checksum).Distinct());
            Assert.Contains(group, r => r.SpeedupVsSlowest == 1.0);
            Assert.All(group, r => Assert.True(r.SpeedupVsSlowest >= 1.0 && r.MeanMicroseconds > 0 && r.Iterations > 0));
        }
        // Allocation differences are deterministic: the span parser allocates nothing per call.
        Assert.True(run.Results.Single(r => r.Workload == "Span Split + ranges").AllocatedBytesPerOp < 1);
        Assert.True(run.Results.Single(r => r.Workload == "string.Split").AllocatedBytesPerOp > 10_000);
    }

    [Fact]
    public async Task Live_runner_rejects_unknown_groups_and_clamps_intensity()
    {
        var runner = new LivePerformanceRunner();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => runner.RunAsync(["nope"], 1, TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<ArgumentException>(() => runner.RunAsync([], 1, TestContext.Current.CancellationToken));
        var run = await runner.RunAsync(["parse"], intensity: 99, TestContext.Current.CancellationToken);
        Assert.Equal(LivePerformanceRunner.MaxIntensity, run.Intensity);
    }

    [Fact]
    public void Live_groups_reference_existing_snippets()
    {
        var catalog = new Core.Source.SourceCatalog([typeof(LivePerformanceRunner).Assembly]);
        foreach (var variant in new LivePerformanceRunner().Groups.SelectMany(g => g.Variants))
        {
            Assert.True(catalog.TryGet(variant.SnippetId, out _), variant.SnippetId);
        }
    }
}
