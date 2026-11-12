using System.IO.Compression;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

public enum CompressionAlgorithm
{
    GZip,
    Brotli,
    /// <summary>In-box from .NET 11 (<c>System.IO.Compression.ZstandardStream</c>).</summary>
    Zstandard,
}

/// <summary>Stream compression with the in-box codecs. Shared with DotNet11Lab.Benchmarks (net10.0 and net11.0).</summary>
public static class CompressionWorkloads
{
    public static bool IsSupported(CompressionAlgorithm algorithm) =>
#if NET11_0_OR_GREATER
        true;
#else
        algorithm != CompressionAlgorithm.Zstandard;
#endif

    // <snippet:Perf.Compress>
    /// <summary>Compresses <paramref name="payload"/> and returns the compressed size in bytes.</summary>
    public static int CompressedLength(byte[] payload, CompressionAlgorithm algorithm, CompressionLevel level)
    {
        using var output = new MemoryStream(capacity: payload.Length / 2);
        using (var compressor = CreateCompressor(output, algorithm, level))
        {
            compressor.Write(payload);
        }
        return (int)output.Length;
    }

    private static Stream CreateCompressor(Stream output, CompressionAlgorithm algorithm, CompressionLevel level) => algorithm switch
    {
        CompressionAlgorithm.GZip => new GZipStream(output, level, leaveOpen: true),
        CompressionAlgorithm.Brotli => new BrotliStream(output, level, leaveOpen: true),
#if NET11_0_OR_GREATER
        CompressionAlgorithm.Zstandard => new ZstandardStream(output, level, leaveOpen: true),
#endif
        _ => throw new NotSupportedException($"{algorithm} is not available on this target framework."),
    };
    // </snippet:Perf.Compress>
}
