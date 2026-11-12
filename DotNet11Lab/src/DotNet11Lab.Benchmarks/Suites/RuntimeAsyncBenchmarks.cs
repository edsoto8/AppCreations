#if NET11_0_OR_GREATER
using BenchmarkDotNet.Attributes;
using ClassicChain = DotNet11Lab.Core.Labs.RuntimeAsync.AsyncChainWorkloads;
using RuntimeAsyncChain = DotNet11Lab.RuntimeAsync.AsyncChainWorkloads;

namespace DotNet11Lab.Benchmarks.Suites;

/// <summary>
/// Lab 7: the same source file compiled twice - once with the classic compiler state machine (linked into this
/// project) and once with runtime-async=on (experimental/DotNet11Lab.RuntimeAsync). .NET 11 job only.
/// latest.json pairs each *_RuntimeAsync method with its *_Classic twin (ratio = runtime async / classic).
/// </summary>
[BenchmarkCategory("RuntimeAsync")]
public class RuntimeAsyncBenchmarks
{
    private int[] _amounts = [];

    [Params(10)]
    public int Depth { get; set; }

    [GlobalSetup]
    public void Setup()
    {
        var random = new Random(42);
        _amounts = new int[1_000];
        for (var i = 0; i < _amounts.Length; i++) _amounts[i] = random.Next(1, 10_000);
    }

    [Benchmark] public Task<int> ChainSync_Classic() => ClassicChain.ChainAsync(Depth, yieldAtLeaf: false, CancellationToken.None);
    [Benchmark] public Task<int> ChainSync_RuntimeAsync() => RuntimeAsyncChain.ChainAsync(Depth, yieldAtLeaf: false, CancellationToken.None);
    [Benchmark] public Task<int> ChainYield_Classic() => ClassicChain.ChainAsync(Depth, yieldAtLeaf: true, CancellationToken.None);
    [Benchmark] public Task<int> ChainYield_RuntimeAsync() => RuntimeAsyncChain.ChainAsync(Depth, yieldAtLeaf: true, CancellationToken.None);
    [Benchmark] public Task<long> PriceOrders_Classic() => ClassicChain.PriceOrdersAsync(_amounts, CancellationToken.None);
    [Benchmark] public Task<long> PriceOrders_RuntimeAsync() => RuntimeAsyncChain.PriceOrdersAsync(_amounts, CancellationToken.None);
}
#endif
