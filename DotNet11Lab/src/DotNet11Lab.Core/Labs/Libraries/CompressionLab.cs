using System.IO.Compression;
using DotNet11Lab.Core.Diagnostics;

namespace DotNet11Lab.Core.Labs.Libraries;

public enum Codec { Zstandard, Brotli, GZip }

public sealed record CodecSettings(int ZstandardQuality = 3, int BrotliQuality = 4, int GZipLevel = 6)
{
    public CodecSettings Normalized() => new(
        Math.Clamp(ZstandardQuality, -7, ZstandardCompressionOptions.MaxQuality),
        Math.Clamp(BrotliQuality, 0, 11),
        Math.Clamp(GZipLevel, 0, 9));

    public int LevelFor(Codec codec) => codec switch
    {
        Codec.Zstandard => ZstandardQuality,
        Codec.Brotli => BrotliQuality,
        Codec.GZip => GZipLevel,
        _ => throw new ArgumentOutOfRangeException(nameof(codec)),
    };
}

public sealed record CodecResult(Codec Codec, int Level, long OriginalBytes, long CompressedBytes, Measurement Compress, Measurement Decompress, bool RoundTripVerified)
{
    public double Ratio => CompressedBytes == 0 ? 0 : (double)OriginalBytes / CompressedBytes;
    public double SavingsPercent => OriginalBytes == 0 ? 0 : 100.0 * (1 - (double)CompressedBytes / OriginalBytes);
    /// <summary>Throughput in MB/s of uncompressed data.</summary>
    public double CompressMBps => OriginalBytes / Compress.MeanMicroseconds;
    public double DecompressMBps => OriginalBytes / Decompress.MeanMicroseconds;
}

public static class StreamCodecs
{
    // <snippet:Libraries.ZstdStream>
    public static byte[] Compress(Codec codec, ReadOnlySpan<byte> data, int level)
    {
        using var output = new MemoryStream();
        using (Stream compressor = codec switch
        {
            // .NET 11: in-box, same shape as BrotliStream / GZipStream.
            Codec.Zstandard => new ZstandardStream(output, new ZstandardCompressionOptions { Quality = level }, leaveOpen: true),
            Codec.Brotli => new BrotliStream(output, new BrotliCompressionOptions { Quality = level }, leaveOpen: true),
            Codec.GZip => new GZipStream(output, new ZLibCompressionOptions { CompressionLevel = level }, leaveOpen: true),
            _ => throw new ArgumentOutOfRangeException(nameof(codec)),
        })
        {
            compressor.Write(data);
        }
        return output.ToArray();
    }

    public static byte[] Decompress(Codec codec, byte[] compressed, int expectedLength)
    {
        using var input = new MemoryStream(compressed);
        using Stream decompressor = codec switch
        {
            Codec.Zstandard => new ZstandardStream(input, CompressionMode.Decompress),
            Codec.Brotli => new BrotliStream(input, CompressionMode.Decompress),
            Codec.GZip => new GZipStream(input, CompressionMode.Decompress),
            _ => throw new ArgumentOutOfRangeException(nameof(codec)),
        };
        using var output = new MemoryStream(expectedLength);
        decompressor.CopyTo(output);
        return output.ToArray();
    }
    // </snippet:Libraries.ZstdStream>

    public static IReadOnlyList<CodecResult> CompareAll(byte[] data, CodecSettings settings, int iterations, CancellationToken cancellationToken)
    {
        settings = settings.Normalized();
        iterations = Math.Clamp(iterations, 1, 50);
        var results = new List<CodecResult>();
        foreach (var codec in Enum.GetValues<Codec>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var level = settings.LevelFor(codec);
            var compressed = Compress(codec, data, level);
            var roundTrip = Decompress(codec, compressed, data.Length).AsSpan().SequenceEqual(data);
            var c = Measure.Run($"{codec} compress", iterations, () => Compress(codec, data, level), cancellationToken);
            var d = Measure.Run($"{codec} decompress", iterations, () => Decompress(codec, compressed, data.Length), cancellationToken);
            results.Add(new(codec, level, data.Length, compressed.Length, c, d, roundTrip));
        }
        return results;
    }
}

public sealed record OneShotResult(int OriginalBytes, int CompressedBytes, long DeclaredContentSize, bool RoundTripVerified);

public static class ZstandardOneShot
{
    // <snippet:Libraries.ZstdOneShot>
    // Span-based, allocation-free one-shot calls: no Stream, no MemoryStream.
    public static OneShotResult RoundTrip(ReadOnlySpan<byte> data, int quality)
    {
        var buffer = new byte[ZstandardEncoder.GetMaxCompressedLength(data.Length)];
        if (!ZstandardEncoder.TryCompress(data, buffer, out var written, quality, ZstandardCompressionOptions.DefaultWindowLog2))
            throw new InvalidOperationException("Destination too small.");
        var frame = buffer.AsSpan(0, written);

        // A Zstandard frame records the content size, so the decoder can size the output exactly.
        ZstandardDecoder.TryGetMaxDecompressedLength(frame, out var declared);
        var restored = new byte[declared];
        var ok = ZstandardDecoder.TryDecompress(frame, restored, out var restoredLength)
                 && restored.AsSpan(0, restoredLength).SequenceEqual(data);
        return new(data.Length, written, declared, ok);
    }
    // </snippet:Libraries.ZstdOneShot>
}

public sealed record DictionaryComparison(
    int TrainingSamples,
    int TestPayloads,
    int DictionaryBytes,
    long RawBytes,
    long ZstdPlainBytes,
    long ZstdDictionaryBytes,
    long GZipBytes,
    long BrotliBytes,
    Measurement TrainTime,
    Measurement PlainCompress,
    Measurement DictionaryCompress,
    bool RoundTripVerified);

public static class ZstandardDictionaries
{
    public const int MaxPayloads = 20_000;

    // <snippet:Libraries.ZstdDictionary>
    public static ZstandardDictionary Train(IReadOnlyList<byte[]> samples, int maxDictionarySize, int quality)
    {
        // Train takes all samples back to back plus the length of each one.
        var concatenated = samples.SelectMany(s => s).ToArray();
        var lengths = samples.Select(s => s.Length).ToArray();
        byte[] trained = ZstandardDictionary.Train(concatenated, lengths, maxDictionarySize);
        return ZstandardDictionary.Create(trained, quality);
    }

    public static byte[] CompressWith(ZstandardDictionary dictionary, ReadOnlySpan<byte> payload)
    {
        var buffer = new byte[ZstandardEncoder.GetMaxCompressedLength(payload.Length)];
        return ZstandardEncoder.TryCompress(payload, buffer, out var written, dictionary, ZstandardCompressionOptions.DefaultWindowLog2)
            ? buffer[..written]
            : throw new InvalidOperationException("Destination too small.");
    }

    public static byte[] DecompressWith(ZstandardDictionary dictionary, ReadOnlySpan<byte> frame, int originalLength)
    {
        var buffer = new byte[originalLength];
        return ZstandardDecoder.TryDecompress(frame, buffer, out var written, dictionary)
            ? buffer[..written]
            : throw new InvalidDataException("Frame did not decompress with this dictionary.");
    }
    // </snippet:Libraries.ZstdDictionary>

    public static DictionaryComparison Compare(int payloadCount, int maxDictionarySize, int quality, CancellationToken cancellationToken)
    {
        payloadCount = Math.Clamp(payloadCount, 50, MaxPayloads);
        maxDictionarySize = Math.Clamp(maxDictionarySize, 1_024, 112_640);
        quality = Math.Clamp(quality, 1, ZstandardCompressionOptions.MaxQuality);

        var payloads = LibrarySampleData.SmallPayloads(payloadCount);
        var trainCount = payloadCount * 7 / 10;          // train on 70 %, measure on the unseen 30 %
        var training = payloads.Take(trainCount).ToList();
        var test = payloads.Skip(trainCount).ToList();

        var trainTime = Measure.Run("Train", 1, () => Train(training, maxDictionarySize, quality).Dispose(), cancellationToken);
        using var dictionary = Train(training, maxDictionarySize, quality);

        long raw = 0, plain = 0, withDict = 0, gzip = 0, brotli = 0;
        var ok = true;
        foreach (var p in test)
        {
            cancellationToken.ThrowIfCancellationRequested();
            raw += p.Length;
            var plainFrame = PlainCompress(p, quality);
            plain += plainFrame.Length;
            var dictFrame = CompressWith(dictionary, p);
            withDict += dictFrame.Length;
            gzip += StreamCodecs.Compress(Codec.GZip, p, 6).Length;
            brotli += StreamCodecs.Compress(Codec.Brotli, p, 4).Length;
            ok &= DecompressWith(dictionary, dictFrame, p.Length).AsSpan().SequenceEqual(p);
        }

        var plainTime = Measure.Run("Zstd per payload", 3, () => { foreach (var p in test) PlainCompress(p, quality); }, cancellationToken);
        var dictTime = Measure.Run("Zstd + dictionary per payload", 3, () => { foreach (var p in test) CompressWith(dictionary, p); }, cancellationToken);

        return new(training.Count, test.Count, dictionary.Data.Length, raw, plain, withDict, gzip, brotli, trainTime, plainTime, dictTime, ok);
    }

    private static byte[] PlainCompress(byte[] payload, int quality)
    {
        var buffer = new byte[ZstandardEncoder.GetMaxCompressedLength(payload.Length)];
        ZstandardEncoder.TryCompress(payload, buffer, out var written, quality, ZstandardCompressionOptions.DefaultWindowLog2);
        return buffer[..written];
    }
}
