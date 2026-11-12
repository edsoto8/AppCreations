# Lab 6 — Library features

Page: `/labs/libraries` · Code: `src/DotNet11Lab.Core/Labs/Libraries/` · UI: `Components/Pages/Labs/Libraries/`
· Tests: `tests/DotNet11Lab.Tests/Lab6Libraries/`

All APIs below are in-box in .NET 11 (no NuGet packages) and were verified by reflection and by running them.

---

## 1. Zstandard (`System.IO.Compression`)

**What's new.** `ZstandardStream` (same shape as `BrotliStream`/`GZipStream`, configured with
`ZstandardCompressionOptions { Quality, WindowLog2, Dictionary, AppendChecksum, ... }`), static one-shot
`ZstandardEncoder.TryCompress` / `ZstandardDecoder.TryDecompress` / `TryGetMaxDecompressedLength`,
`ZstandardEncoder.GetMaxCompressedLength`, and `ZstandardDictionary.Train(samples, sampleLengths, maxDictionarySize)` +
`ZstandardDictionary.Create(bytes, quality)`. Quality range: `MinQuality` −131072 … `MaxQuality` 22, default 3.

**Why it matters.** zstd in-box removes a native-wrapper dependency, gives one quality knob from very fast to very
strong, and dictionaries make small messages compressible.

**Examples.** `Libraries.ZstdStream` (all three codecs through one Stream pattern), `Libraries.ZstdOneShot`,
`Libraries.ZstdDictionary`.

**Previous approach.** GZip/Brotli in-box, or a third-party zstd package.

**Measured on the page (not hard-coded).** The comparison compresses generated JSON transaction logs or text logs
(1 KB–16 MB) at user-chosen levels, verifies byte-identical round trips and times both directions. On 1 MB of JSON at
defaults (zstd 3, Brotli 4, GZip 6) one dev-container run gave ratios 9.3× / 10.2× / 10.2× and compress throughput
~350–500 / ~195 / ~135 MB/s: zstd compressed fastest, at a slightly lower ratio at its default level. Results depend on
data and level; that is why the page measures. Dictionary demo (2 000 ~180-byte JSON payloads, 16 KB dictionary trained
on 70 %): plain zstd 1.14× → with dictionary 3.98× (GZip per payload ~1.1×, Brotli ~1.3×). A frame compressed with a
dictionary cannot be decompressed without it (`TryDecompress` returns `false`, tested).

**Production use cases.** Logs, exports, backups, caches; service-to-service HTTP (ASP.NET Core 11 supports zstd
response compression); dictionaries for queue messages, webhooks, cache entries.

**When not to use.** Browser-facing static assets (precompressed Brotli is smallest); consumers that only read gzip/zip;
dictionaries for frequently changing shapes (version them).

---

## 2. Memory stream adapters

**What's new.** `System.IO.ReadOnlyMemoryStream(ReadOnlyMemory<byte>)`, `System.IO.WritableMemoryStream(Memory<byte>)`,
`System.IO.StringStream(string | ReadOnlyMemory<char>, Encoding)`, `System.Buffers.ReadOnlySequenceStream(ReadOnlySequence<byte>)`.

**Example.** `Libraries.ReadOnlyMemoryStream` (checksum a slice / a string / a multi-segment sequence through a Stream).
**Previous approach.** `Libraries.LegacyMemoryStream`: `new MemoryStream(memory.ToArray())`,
`new MemoryStream(Encoding.UTF8.GetBytes(s))`, `new MemoryStream(sequence.ToArray())`.

**Measured.** SHA-256 of a 2 MB JSON payload: the copy routes allocate ~1.9 MB per operation (a LOH allocation), the
adapters ~150–380 bytes, and run roughly 2× faster in a typical run; all routes produce the same hash (tested).

**Behaviour verified by running (`Libraries.WritableMemoryStream`).**
- `WritableMemoryStream.Length` starts at the **full capacity** (like `new MemoryStream(byte[])`), not 0; `SetLength`
  can shrink it.
- A write that does not fit throws `NotSupportedException: Unable to expand length of this stream beyond its capacity.`
  and writes nothing (`Position` and buffer unchanged).
- It accepts any `Memory<byte>` (the legacy route needs `MemoryMarshal.TryGetArray`, `Libraries.LegacyWritableMemoryStream`).
- `StringStream` and `ReadOnlySequenceStream` are forward-only (`CanSeek == false`; `Length`/`Position` throw).
  `StringStream` writes no preamble/BOM even for `new UTF8Encoding(true)`.

**When not to use.** Consumers that must seek forward-only adapters; memory that may be returned to a pool or mutated
while being read; growable output.

---

## 3. JSON Lines output

**What's new.** `JsonSerializer.SerializeAsyncEnumerable(Stream | PipeWriter, IAsyncEnumerable<T>, [JsonTypeInfo<T> |
options], topLevelValues: true, ct)` writes one compact value plus `\n` per item, including the last, ignoring
`WriteIndented`. With `topLevelValues: false` (default) it writes one JSON array. Reading JSONL
(`DeserializeAsyncEnumerable(..., topLevelValues: true)`) existed since .NET 9.

**Example.** `Libraries.JsonLinesWrite` with the source-generated `LibrariesJsonContext` (Web defaults: camelCase).
**Previous approach.** `Libraries.LegacyJsonLinesWrite`: a loop of `SerializeAsync` + `WriteByte('\n')`.
The page shows the raw output, reads it back, and checks the bytes equal the legacy loop's (also tested for exact format).

**Performance.** Streams without buffering the sequence; memory stays flat regardless of item count.

**When not to use.** Clients expecting one JSON document; small bounded lists.

---

## 4. More System.Text.Json / BCL additions

| Feature | Example | Verified behaviour |
|---|---|---|
| `JsonSerializerOptions.InferClosedTypePolymorphism` | `Libraries.InferClosedPolymorphism` with `closed record PaymentEvent` (`Libraries.ClosedPaymentEvents`) | Without it, `List<PaymentEvent>` serializes as `[{"PaymentId":"pay_481"},...]`: derived data silently lost. With it: `$type` discriminators and correct round trip. |
| `JsonNamingPolicy.PascalCase` | `Libraries.PascalCase` | `orderId`→`OrderId`, `order_id`→`Order_Id`, `ORDER`→`Order`, `transaction-ref`→`Transaction-Ref`, `iPhone`→`IPhone`. Used here as `DictionaryKeyPolicy`. |
| `JsonSerializerOptions.GetTypeInfo<T>()` / `TryGetTypeInfo<T>` | `Libraries.GetTypeInfoGeneric` vs `Libraries.LegacyGetTypeInfo` (cast) | Returns `JsonTypeInfo<T>` from the source-generated resolver. |
| `EqualityComparer<T>.Create(keySelector, keyComparer = null)` | `Libraries.EqualityComparerCreate` vs `Libraries.LegacyEqualityComparer` | The key selector parameter is `Func<T?, TKey>` (nullable input): write `d => d?.EventId`. Dedupes retried webhooks by `EventId`. |

**When not to use.** Polymorphic JSON from untrusted input without validating `$type`; discriminators that must survive
renames (use explicit `[JsonDerivedType(typeof(X), "x")]`); allocating key selectors on hot paths.

## Docs

- [What's new in .NET 11 libraries](https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/libraries)
- [Union types in System.Text.Json](https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/union-types)
- [What's new in .NET 11 overview](https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/overview)
