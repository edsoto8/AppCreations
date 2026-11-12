using System.IO.Compression;
using System.Text;
using System.Text.Json;
using DotNet11Lab.Core.Labs.Libraries;

namespace DotNet11Lab.Tests.Lab6Libraries;

public class CompressionTests
{
    [Theory]
    [InlineData(Codec.Zstandard, 3)]
    [InlineData(Codec.Zstandard, 19)]
    [InlineData(Codec.Brotli, 5)]
    [InlineData(Codec.GZip, 9)]
    public void Stream_codecs_round_trip(Codec codec, int level)
    {
        var data = LibrarySampleData.Generate(SampleKind.JsonTransactionLog, 64 * 1024);

        var compressed = StreamCodecs.Compress(codec, data, level);

        Assert.True(compressed.Length < data.Length / 3);
        Assert.Equal(data, StreamCodecs.Decompress(codec, compressed, data.Length));
    }

    [Fact]
    public void Zstandard_output_is_a_real_zstd_frame()
    {
        var compressed = StreamCodecs.Compress(Codec.Zstandard, "hello hello hello"u8, 3);
        Assert.Equal(new byte[] { 0x28, 0xB5, 0x2F, 0xFD }, compressed[..4]);   // zstd magic number
    }

    [Fact]
    public void Compare_all_measures_every_codec_and_verifies_round_trips()
    {
        var data = LibrarySampleData.Generate(SampleKind.TextLog, 32 * 1024);

        var results = StreamCodecs.CompareAll(data, new CodecSettings(3, 4, 6), 2, TestContext.Current.CancellationToken);

        Assert.Equal(Enum.GetValues<Codec>(), results.Select(r => r.Codec));
        Assert.All(results, r =>
        {
            Assert.True(r.RoundTripVerified);
            Assert.True(r.Ratio > 1);
            Assert.True(r.Compress.Elapsed > TimeSpan.Zero);
        });
    }

    [Fact]
    public void Settings_are_clamped()
    {
        var s = new CodecSettings(99, 99, 99).Normalized();
        Assert.Equal((ZstandardCompressionOptions.MaxQuality, 11, 9), (s.ZstandardQuality, s.BrotliQuality, s.GZipLevel));
    }

    [Fact]
    public void One_shot_api_records_content_size_and_round_trips()
    {
        var data = LibrarySampleData.Generate(SampleKind.JsonTransactionLog, 20_000);

        var result = ZstandardOneShot.RoundTrip(data, 5);

        Assert.True(result.RoundTripVerified);
        Assert.Equal(data.Length, result.DeclaredContentSize);
        Assert.True(result.CompressedBytes < data.Length);
    }

    [Fact]
    public void Trained_dictionary_beats_plain_zstd_on_small_payloads()
    {
        var result = ZstandardDictionaries.Compare(1_000, 8_192, 3, TestContext.Current.CancellationToken);

        Assert.True(result.RoundTripVerified);
        Assert.Equal(700, result.TrainingSamples);
        Assert.Equal(300, result.TestPayloads);
        Assert.InRange(result.DictionaryBytes, 1, 8_192);
        Assert.True(result.ZstdDictionaryBytes < result.ZstdPlainBytes / 2,
            $"dictionary {result.ZstdDictionaryBytes} vs plain {result.ZstdPlainBytes}");
    }

    [Fact]
    public void Frame_compressed_with_a_dictionary_needs_that_dictionary()
    {
        var payloads = LibrarySampleData.SmallPayloads(200);
        using var dictionary = ZstandardDictionaries.Train(payloads, 4_096, 3);
        var frame = ZstandardDictionaries.CompressWith(dictionary, payloads[0]);

        Assert.Equal(payloads[0], ZstandardDictionaries.DecompressWith(dictionary, frame, payloads[0].Length));
        var buffer = new byte[payloads[0].Length];
        Assert.False(ZstandardDecoder.TryDecompress(frame, buffer, out _));   // no dictionary supplied
    }
}

public class StreamAdapterTests
{
    [Fact]
    public void Adapters_produce_the_same_bytes_and_allocate_less()
    {
        var results = StreamAdapters.Compare(256 * 1024, 3, TestContext.Current.CancellationToken);

        Assert.Equal(3, results.Count);
        Assert.All(results, r =>
        {
            Assert.True(r.SameBytes, r.Scenario);
            Assert.True(r.New.AllocatedBytes < r.Previous.AllocatedBytes / 4, $"{r.Scenario}: {r.New.AllocatedBytes} vs {r.Previous.AllocatedBytes}");
        });
    }

    [Fact]
    public void Read_only_memory_stream_reads_a_slice_without_writing()
    {
        var buffer = "xxHELLOxx"u8.ToArray();
        using var stream = new ReadOnlyMemoryStream(buffer.AsMemory(2, 5));

        Assert.False(stream.CanWrite);
        Assert.Equal(5, stream.Length);
        Assert.Equal("HELLO", new StreamReader(stream).ReadToEnd());
    }

    [Fact]
    public void String_stream_encodes_without_preamble_and_is_forward_only()
    {
        using var stream = new StringStream("héllo", new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        using var copy = new MemoryStream();
        stream.CopyTo(copy);

        Assert.False(stream.CanSeek);
        Assert.Equal(Encoding.UTF8.GetBytes("héllo"), copy.ToArray());
    }

    [Fact]
    public void Sequence_stream_reads_across_segments()
    {
        var data = Enumerable.Range(0, 100_000).Select(i => (byte)i).ToArray();
        var sequence = StreamAdapters.Segments(data, 4_096);
        Assert.False(sequence.IsSingleSegment);

        using var stream = new System.Buffers.ReadOnlySequenceStream(sequence);
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        Assert.Equal(data, copy.ToArray());
    }

    [Fact]
    public void Writable_memory_stream_rejects_writes_past_capacity_atomically()
    {
        var log = StreamAdapters.WriteIntoFixedBuffer(capacity: 64, recordBytes: 100);

        Assert.Equal("Length = 64, Position = 0, CanSeek = True", log[0].Observed);   // Length starts at capacity
        Assert.StartsWith("NotSupportedException", log[1].Observed, StringComparison.Ordinal);
        Assert.Equal("Position = 0; buffer untouched = True", log[2].Observed);
    }

    [Fact]
    public void Writable_memory_stream_within_capacity_can_trim_length()
    {
        var log = StreamAdapters.WriteIntoFixedBuffer(capacity: 64, recordBytes: 40);

        Assert.Equal("OK. Position = 40, Length = 64", log[1].Observed);
        Assert.Equal("Length = 40", log[2].Observed);
    }

    [Fact]
    public void Legacy_fixed_memory_stream_also_refuses_to_grow()
    {
        var log = StreamAdapters.LegacyWriteIntoFixedBuffer(64, 100);
        Assert.StartsWith("NotSupportedException", log[^1].Observed, StringComparison.Ordinal);
    }
}

public class JsonFeatureTests
{
    [Fact]
    public async Task Json_lines_output_is_exactly_one_compact_value_per_line()
    {
        using var stream = new MemoryStream();
        await JsonLines.WriteAsync(stream, LibrarySampleData.TransactionsAsync(3, cancellationToken: TestContext.Current.CancellationToken), TestContext.Current.CancellationToken);

        var text = Encoding.UTF8.GetString(stream.ToArray());
        var expected = string.Concat(LibrarySampleData.Transactions(3)
            .Select(t => JsonSerializer.Serialize(t, LibrariesJsonContext.Default.TransactionEvent) + "\n"));

        Assert.Equal(expected, text);
        Assert.EndsWith("}\n", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\n\n", text, StringComparison.Ordinal);
        Assert.StartsWith("{\"id\":\"tx_11", text, StringComparison.Ordinal);   // Web defaults: camelCase
    }

    [Fact]
    public async Task Json_lines_round_trip_and_match_the_legacy_loop()
    {
        var result = await JsonLines.RunAsync(500, TestContext.Current.CancellationToken);

        Assert.True(result.IdenticalToLegacy);
        Assert.Equal(500, result.ReadBack);
        Assert.Equal(LibrarySampleData.Transactions(500).Sum(t => t.Amount), result.ReadBackTotal);
        Assert.StartsWith("[{", result.ArrayModePreview, StringComparison.Ordinal);
    }

    [Fact]
    public void Closed_hierarchy_polymorphism_is_inferred_only_when_enabled()
    {
        var demo = JsonEnhancements.Polymorphism();

        Assert.Equal("""[{"PaymentId":"pay_481"},{"PaymentId":"pay_481"},{"PaymentId":"pay_481"}]""", demo.WithoutInference);
        Assert.Contains("\"$type\":\"PaymentRefunded\"", demo.WithInference, StringComparison.Ordinal);
        Assert.Equal("PaymentAuthorized, PaymentCaptured, PaymentRefunded", demo.RoundTripped);
    }

    [Fact]
    public void Pascal_case_policy_converts_names_and_dictionary_keys()
    {
        Assert.Equal([("orderId", "OrderId"), ("ORDER", "Order")], JsonEnhancements.PascalCaseNames(["orderId", "ORDER"]));
        var json = JsonEnhancements.NormalizeMetadata(new() { ["orderId"] = "1", ["channel"] = "web" });
        Assert.Equal(["OrderId", "Channel"], JsonDocument.Parse(json).RootElement.EnumerateObject().Select(p => p.Name));
    }

    [Fact]
    public void Generic_get_type_info_returns_the_source_generated_contract()
    {
        var demo = JsonEnhancements.InspectContract();

        Assert.Equal("Object", demo.Kind);
        Assert.Contains("amount: Decimal", demo.Properties);
        Assert.Same(JsonEnhancements.LegacyInspectContract(new JsonSerializerOptions(JsonSerializerDefaults.Web) { TypeInfoResolver = LibrariesJsonContext.Default }).Type,
            typeof(TransactionEvent));
    }

    [Fact]
    public void Key_selector_comparer_dedupes_retried_webhooks()
    {
        var demo = JsonEnhancements.Dedupe(1_000);

        Assert.Equal(1_000, demo.UniqueWithKeyComparer);
        Assert.Equal(demo.UniqueWithLegacyComparer, demo.UniqueWithKeyComparer);
        Assert.Equal(demo.Deliveries, demo.UniqueWithRecordEquality);    // records differ by Attempt, so no dedupe
        Assert.True(demo.Deliveries > 1_000);
    }
}
