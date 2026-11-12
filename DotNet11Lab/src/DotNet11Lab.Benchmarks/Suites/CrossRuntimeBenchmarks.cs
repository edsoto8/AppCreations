using System.Collections.Frozen;
using System.IO.Compression;
using BenchmarkDotNet.Attributes;
using DotNet11Lab.Core.Labs.Performance.Workloads;

namespace DotNet11Lab.Benchmarks.Suites;

// Every class here runs on both the .NET 10 (baseline) and .NET 11 jobs. The workloads are the linked files from
// DotNet11Lab.Core/Labs/Performance/Workloads, i.e. the same code the dashboard measures live.
// Category names are used verbatim by results/benchmarks/latest.json and the dashboard.

[BenchmarkCategory("Text")]
public class TextBenchmarks
{
    private string _csv = "";

    [GlobalSetup]
    public void Setup() => _csv = WorkloadData.CreateCsvNumbers(1_000);

    [Benchmark] public long ParseWithSplit() => TextWorkloads.SumWithSplit(_csv);
    [Benchmark] public long ParseWithSpans() => TextWorkloads.SumWithSpans(_csv);
    [Benchmark] public int BuildWithConcat() => TextWorkloads.BuildWithConcat(300);
    [Benchmark] public int BuildWithStringBuilder() => TextWorkloads.BuildWithStringBuilder(300);
}

[BenchmarkCategory("Streams")]
public class StreamBenchmarks
{
    private byte[] _ledger = [];

    [GlobalSetup]
    public void Setup() => _ledger = WorkloadData.CreateLedger(10_000);

    [Benchmark] public Task<long> StreamReaderSplit() => StreamWorkloads.SumWithStreamReaderAsync(_ledger);
    [Benchmark] public Task<long> PipeReaderSpans() => StreamWorkloads.SumWithPipeReaderAsync(_ledger);
}

[BenchmarkCategory("Json")]
public class JsonBenchmarks
{
    private List<Order> _orders = [];
    private string _json = "";

    [GlobalSetup]
    public void Setup()
    {
        _orders = WorkloadData.CreateOrders(200);
        _json = JsonWorkloads.SerializeWithSourceGen(_orders);
    }

    [Benchmark] public string SerializeReflection() => JsonWorkloads.SerializeWithReflection(_orders);
    [Benchmark] public string SerializeSourceGen() => JsonWorkloads.SerializeWithSourceGen(_orders);
    [Benchmark] public List<Order> DeserializeReflection() => JsonWorkloads.DeserializeWithReflection(_json);
    [Benchmark] public List<Order> DeserializeSourceGen() => JsonWorkloads.DeserializeWithSourceGen(_json);
}

[BenchmarkCategory("Async")]
public class AsyncBenchmarks
{
    private const int Calls = 10_000;

    [Benchmark] public long Synchronous() => AsyncWorkloads.SumSynchronously(Calls);
    [Benchmark] public Task<long> TaskOfInt() => AsyncWorkloads.SumViaTaskAsync(Calls);
    [Benchmark] public Task<long> ValueTaskOfInt() => AsyncWorkloads.SumViaValueTaskAsync(Calls);
}

[BenchmarkCategory("Collections")]
public class CollectionBenchmarks
{
    private int[] _values = [];
    private Dictionary<string, int> _map = [];
    private FrozenDictionary<string, int> _frozen = FrozenDictionary<string, int>.Empty;
    private string[] _probes = [];

    [GlobalSetup]
    public void Setup()
    {
        _values = WorkloadData.CreateIntegers(100_000);
        (_map, _frozen, _probes) = WorkloadData.CreateLookup(1_000, 10_000);
    }

    [Benchmark] public long LinqWhereSelectSum() => CollectionWorkloads.SumWithLinq(_values);
    [Benchmark] public long ForeachLoop() => CollectionWorkloads.SumWithLoop(_values);
    [Benchmark] public long DictionaryLookup() => CollectionWorkloads.LookupAll(_map, _probes);
    [Benchmark] public long FrozenDictionaryLookup() => CollectionWorkloads.LookupAll(_frozen, _probes);
}

[BenchmarkCategory("Compression")]
public class CompressionBenchmarks
{
    private byte[] _payload = [];

    [GlobalSetup]
    public void Setup() => _payload = WorkloadData.CreateLedger(12_000); // ~250 KB of ledger text

    [Benchmark] public int GZipOptimal() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.GZip, CompressionLevel.Optimal);
    [Benchmark] public int GZipFastest() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.GZip, CompressionLevel.Fastest);
    [Benchmark] public int BrotliOptimal() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.Brotli, CompressionLevel.Optimal);
    [Benchmark] public int BrotliFastest() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.Brotli, CompressionLevel.Fastest);
}

#if NET11_0_OR_GREATER
/// <summary>
/// Zstandard is in-box only from .NET 11, so this class exists only in the net11.0 build and runs on the .NET 11
/// job only (see <see cref="LabBenchmarkConfig"/>). Compare its numbers with <see cref="CompressionBenchmarks"/>.
/// </summary>
[BenchmarkCategory("Compression")]
public class ZstandardBenchmarks
{
    private byte[] _payload = [];

    [GlobalSetup]
    public void Setup() => _payload = WorkloadData.CreateLedger(12_000);

    [Benchmark] public int ZstandardOptimal() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.Zstandard, CompressionLevel.Optimal);
    [Benchmark] public int ZstandardFastest() => CompressionWorkloads.CompressedLength(_payload, CompressionAlgorithm.Zstandard, CompressionLevel.Fastest);
}
#endif
