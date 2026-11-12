# Benchmark results

- Generated: 2026-11-12 19:33:24Z · mode `full`
- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz (4 physical / 4 logical cores, X64), Linux Ubuntu 24.04.5 LTS (Noble Numbat)
- Host runtime: .NET 11.0.0 (11.0.0, 11.0.26.53018) · SDK 11.0.100 · BenchmarkDotNet 0.15.8
- Note: Integrator final run (Job.MediumRun) on an otherwise idle 4-vCPU cloud VM

Verdict: a ratio is reported as faster/slower only when the difference is at least 2 combined standard deviations; otherwise "within noise".

| Category | Benchmark | Runtime | Mean | StdDev | Ratio | Verdict | Allocated | Alloc ratio |
|---|---|---|---:|---:|---:|---|---:|---:|
| Async | AsyncBenchmarks.Synchronous | .NET 10.0 | 5.03 µs | 408.8 ns | 1.00 | baseline | 0 B | - |
| Async | AsyncBenchmarks.Synchronous | .NET 11.0 | 5.18 µs | 334.4 ns | 1.03 | within noise | 0 B | - |
| Async | AsyncBenchmarks.TaskOfInt | .NET 10.0 | 219.49 µs | 16.70 µs | 1.00 | baseline | 703.0 KB | 1.00 |
| Async | AsyncBenchmarks.TaskOfInt | .NET 11.0 | 211.20 µs | 18.57 µs | 0.96 | within noise | 703.0 KB | 1.00 |
| Async | AsyncBenchmarks.ValueTaskOfInt | .NET 10.0 | 108.82 µs | 5.04 µs | 1.00 | baseline | 72 B | 1.00 |
| Async | AsyncBenchmarks.ValueTaskOfInt | .NET 11.0 | 61.54 µs | 7.08 µs | 0.57 | faster | 72 B | 1.00 |
| Collections | CollectionBenchmarks.DictionaryLookup | .NET 10.0 | 272.04 µs | 28.29 µs | 1.00 | baseline | 0 B | - |
| Collections | CollectionBenchmarks.DictionaryLookup | .NET 11.0 | 278.99 µs | 13.47 µs | 1.03 | within noise | 0 B | - |
| Collections | CollectionBenchmarks.ForeachLoop | .NET 10.0 | 460.12 µs | 26.80 µs | 1.00 | baseline | 0 B | - |
| Collections | CollectionBenchmarks.ForeachLoop | .NET 11.0 | 465.93 µs | 19.92 µs | 1.01 | within noise | 0 B | - |
| Collections | CollectionBenchmarks.FrozenDictionaryLookup | .NET 10.0 | 152.88 µs | 20.79 µs | 1.00 | baseline | 0 B | - |
| Collections | CollectionBenchmarks.FrozenDictionaryLookup | .NET 11.0 | 163.39 µs | 12.52 µs | 1.07 | within noise | 0 B | - |
| Collections | CollectionBenchmarks.LinqWhereSelectSum | .NET 10.0 | 570.74 µs | 28.59 µs | 1.00 | baseline | 104 B | 1.00 |
| Collections | CollectionBenchmarks.LinqWhereSelectSum | .NET 11.0 | 558.49 µs | 31.29 µs | 0.98 | within noise | 104 B | 1.00 |
| Compression | CompressionBenchmarks.BrotliFastest | .NET 10.0 | 1.34 ms | 60.67 µs | 1.00 | baseline | 115.5 KB | 1.00 |
| Compression | CompressionBenchmarks.BrotliFastest | .NET 11.0 | 1.37 ms | 113.85 µs | 1.02 | within noise | 115.5 KB | 1.00 |
| Compression | CompressionBenchmarks.BrotliOptimal | .NET 10.0 | 4.28 ms | 371.08 µs | 1.00 | baseline | 115.5 KB | 1.00 |
| Compression | CompressionBenchmarks.BrotliOptimal | .NET 11.0 | 4.34 ms | 301.84 µs | 1.01 | within noise | 115.5 KB | 1.00 |
| Compression | CompressionBenchmarks.GZipFastest | .NET 10.0 | 1.55 ms | 129.50 µs | 1.00 | baseline | 346.2 KB | 1.00 |
| Compression | CompressionBenchmarks.GZipFastest | .NET 11.0 | 1.57 ms | 59.50 µs | 1.02 | within noise | 346.2 KB | 1.00 |
| Compression | CompressionBenchmarks.GZipOptimal | .NET 10.0 | 5.28 ms | 350.25 µs | 1.00 | baseline | 115.6 KB | 1.00 |
| Compression | CompressionBenchmarks.GZipOptimal | .NET 11.0 | 4.98 ms | 283.85 µs | 0.94 | within noise | 115.6 KB | 1.00 |
| Compression | ZstandardBenchmarks.ZstandardFastest | .NET 11.0 | 913.08 µs | 112.29 µs | - | - | 115.6 KB | - |
| Compression | ZstandardBenchmarks.ZstandardOptimal | .NET 11.0 | 1.55 ms | 72.36 µs | - | - | 115.6 KB | - |
| Json | JsonBenchmarks.DeserializeReflection | .NET 10.0 | 371.17 µs | 36.12 µs | 1.00 | baseline | 192.4 KB | 1.00 |
| Json | JsonBenchmarks.DeserializeReflection | .NET 11.0 | 362.78 µs | 41.79 µs | 0.98 | within noise | 192.4 KB | 1.00 |
| Json | JsonBenchmarks.DeserializeSourceGen | .NET 10.0 | 414.61 µs | 65.65 µs | 1.00 | baseline | 192.4 KB | 1.00 |
| Json | JsonBenchmarks.DeserializeSourceGen | .NET 11.0 | 370.76 µs | 21.61 µs | 0.89 | within noise | 192.4 KB | 1.00 |
| Json | JsonBenchmarks.SerializeReflection | .NET 10.0 | 235.57 µs | 42.45 µs | 1.00 | baseline | 99.0 KB | 1.00 |
| Json | JsonBenchmarks.SerializeReflection | .NET 11.0 | 168.11 µs | 14.75 µs | 0.71 | within noise | 99.0 KB | 1.00 |
| Json | JsonBenchmarks.SerializeSourceGen | .NET 10.0 | 165.50 µs | 30.67 µs | 1.00 | baseline | 98.7 KB | 1.00 |
| Json | JsonBenchmarks.SerializeSourceGen | .NET 11.0 | 101.94 µs | 6.13 µs | 0.62 | faster | 98.7 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainSync_Classic(Depth=10) | .NET 11.0 | 146.4 ns | 16.8 ns | 1.00 | baseline | 216 B | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainSync_RuntimeAsync(Depth=10) | .NET 11.0 | 71.9 ns | 11.3 ns | 0.49 | faster | 72 B | 0.33 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainYield_Classic(Depth=10) | .NET 11.0 | 2.75 µs | 162.4 ns | 1.00 | baseline | 1.3 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.ChainYield_RuntimeAsync(Depth=10) | .NET 11.0 | 2.33 µs | 94.3 ns | 0.85 | faster | 744 B | 0.56 |
| RuntimeAsync | RuntimeAsyncBenchmarks.PriceOrders_Classic(Depth=10) | .NET 11.0 | 44.10 µs | 2.93 µs | 1.00 | baseline | 2.2 KB | 1.00 |
| RuntimeAsync | RuntimeAsyncBenchmarks.PriceOrders_RuntimeAsync(Depth=10) | .NET 11.0 | 36.10 µs | 3.36 µs | 0.82 | within noise | 1.4 KB | 0.65 |
| Streams | StreamBenchmarks.PipeReaderSpans | .NET 10.0 | 239.30 µs | 30.37 µs | 1.00 | baseline | 2.7 KB | 1.00 |
| Streams | StreamBenchmarks.PipeReaderSpans | .NET 11.0 | 231.91 µs | 24.55 µs | 0.97 | within noise | 2.7 KB | 1.00 |
| Streams | StreamBenchmarks.StreamReaderSplit | .NET 10.0 | 1.34 ms | 134.22 µs | 1.00 | baseline | 2.79 MB | 1.00 |
| Streams | StreamBenchmarks.StreamReaderSplit | .NET 11.0 | 1.34 ms | 210.66 µs | 1.00 | within noise | 2.79 MB | 1.00 |
| Text | TextBenchmarks.BuildWithConcat | .NET 10.0 | 166.14 µs | 13.17 µs | 1.00 | baseline | 1.08 MB | 1.00 |
| Text | TextBenchmarks.BuildWithConcat | .NET 11.0 | 158.63 µs | 11.77 µs | 0.95 | within noise | 1.08 MB | 1.00 |
| Text | TextBenchmarks.BuildWithStringBuilder | .NET 10.0 | 8.23 µs | 867.3 ns | 1.00 | baseline | 16.8 KB | 1.00 |
| Text | TextBenchmarks.BuildWithStringBuilder | .NET 11.0 | 8.05 µs | 1.06 µs | 0.98 | within noise | 16.8 KB | 1.00 |
| Text | TextBenchmarks.ParseWithSpans | .NET 10.0 | 15.91 µs | 2.34 µs | 1.00 | baseline | 0 B | - |
| Text | TextBenchmarks.ParseWithSpans | .NET 11.0 | 16.15 µs | 1.71 µs | 1.02 | within noise | 0 B | - |
| Text | TextBenchmarks.ParseWithSplit | .NET 10.0 | 24.74 µs | 4.58 µs | 1.00 | baseline | 39.0 KB | 1.00 |
| Text | TextBenchmarks.ParseWithSplit | .NET 11.0 | 24.08 µs | 4.11 µs | 0.97 | within noise | 39.0 KB | 1.00 |
