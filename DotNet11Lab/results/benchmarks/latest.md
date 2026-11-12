# Benchmark results

> **PRELIMINARY** - produced by a smoke/validation run (short job and/or a contended machine). Do not quote these numbers.

- Generated: 2026-11-12 18:45:25Z · mode `quick (filter: *TextBenchmarks.Parse* *StreamBenchmarks.* *JsonBenchmarks.Serialize* *AsyncBenchmarks.* *CollectionBenchmarks.*Lookup *GZipFastest *ZstandardFastest)`
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz (4 physical / 4 logical cores, X64), Linux Ubuntu 24.04.5 LTS (Noble Numbat)
- Host runtime: .NET 11.0.0 (11.0.0, 11.0.26.53018) · SDK 11.0.100 · BenchmarkDotNet 0.15.8
- Note: Pipeline validation only: --quick job (1 warm-up, 3 iterations) on a shared 4-core container while other builds ran. Not representative.

| Category | Benchmark | Runtime | Mean | Ratio | Allocated | Alloc ratio |
|---|---|---|---:|---:|---:|---:|
| Async | AsyncBenchmarks.Synchronous | .NET 10.0 | 5.16 µs | 1.00 | 0 B | - |
| Async | AsyncBenchmarks.Synchronous | .NET 11.0 | 5.36 µs | 1.04 | 0 B | - |
| Async | AsyncBenchmarks.TaskOfInt | .NET 10.0 | 239.35 µs | 1.00 | 703.0 KB | 1.00 |
| Async | AsyncBenchmarks.TaskOfInt | .NET 11.0 | 225.15 µs | 0.94 | 703.0 KB | 1.00 |
| Async | AsyncBenchmarks.ValueTaskOfInt | .NET 10.0 | 110.41 µs | 1.00 | 72 B | 1.00 |
| Async | AsyncBenchmarks.ValueTaskOfInt | .NET 11.0 | 87.94 µs | 0.80 | 72 B | 1.00 |
| Collections | CollectionBenchmarks.DictionaryLookup | .NET 10.0 | 252.97 µs | 1.00 | 0 B | - |
| Collections | CollectionBenchmarks.DictionaryLookup | .NET 11.0 | 344.39 µs | 1.36 | 0 B | - |
| Collections | CollectionBenchmarks.FrozenDictionaryLookup | .NET 10.0 | 151.83 µs | 1.00 | 0 B | - |
| Collections | CollectionBenchmarks.FrozenDictionaryLookup | .NET 11.0 | 190.33 µs | 1.25 | 0 B | - |
| Compression | CompressionBenchmarks.GZipFastest | .NET 10.0 | 1.58 ms | 1.00 | 346.2 KB | 1.00 |
| Compression | CompressionBenchmarks.GZipFastest | .NET 11.0 | 1.46 ms | 0.92 | 346.2 KB | 1.00 |
| Compression | ZstandardBenchmarks.ZstandardFastest | .NET 11.0 | 954.61 µs | - | 115.6 KB | - |
| Json | JsonBenchmarks.SerializeReflection | .NET 10.0 | 196.94 µs | 1.00 | 99.0 KB | 1.00 |
| Json | JsonBenchmarks.SerializeReflection | .NET 11.0 | 236.42 µs | 1.20 | 99.0 KB | 1.00 |
| Json | JsonBenchmarks.SerializeSourceGen | .NET 10.0 | 131.80 µs | 1.00 | 98.7 KB | 1.00 |
| Json | JsonBenchmarks.SerializeSourceGen | .NET 11.0 | 139.69 µs | 1.06 | 98.7 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainSync_Classic([Depth=10]) | .NET 11.0 | 150.2 ns | 1.00 | 216 B | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainSync_RuntimeAsync([Depth=10]) | .NET 11.0 | 71.2 ns | 0.47 | 72 B | 0.33 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainYield_Classic([Depth=10]) | .NET 11.0 | 3.18 µs | 1.00 | 1.3 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainYield_RuntimeAsync([Depth=10]) | .NET 11.0 | 2.56 µs | 0.81 | 744 B | 0.58 |
| RuntimeAsync | RuntimeAsyncBenchmarks.PriceOrders_Classic([Depth=10]) | .NET 11.0 | 81.33 µs | 1.00 | 2.2 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.PriceOrders_RuntimeAsync([Depth=10]) | .NET 11.0 | 33.47 µs | 0.41 | 1.5 KB | 0.65 |
| Streams | StreamBenchmarks.PipeReaderSpans | .NET 10.0 | 213.29 µs | 1.00 | 2.7 KB | 1.00 |
| Streams | StreamBenchmarks.PipeReaderSpans | .NET 11.0 | 233.25 µs | 1.09 | 2.7 KB | 1.00 |
| Streams | StreamBenchmarks.StreamReaderSplit | .NET 10.0 | 1.36 ms | 1.00 | 2.79 MB | 1.00 |
| Streams | StreamBenchmarks.StreamReaderSplit | .NET 11.0 | 1.58 ms | 1.16 | 2.79 MB | 1.00 |
| Text | TextBenchmarks.ParseWithSpans | .NET 10.0 | 16.05 µs | 1.00 | 0 B | - |
| Text | TextBenchmarks.ParseWithSpans | .NET 11.0 | 15.94 µs | 0.99 | 0 B | - |
| Text | TextBenchmarks.ParseWithSplit | .NET 10.0 | 23.06 µs | 1.00 | 39.0 KB | 1.00 |
| Text | TextBenchmarks.ParseWithSplit | .NET 11.0 | 23.53 µs | 1.02 | 39.0 KB | 1.00 |
