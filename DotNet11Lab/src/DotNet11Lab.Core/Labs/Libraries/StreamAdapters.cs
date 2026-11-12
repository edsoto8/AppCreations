using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using DotNet11Lab.Core.Diagnostics;

namespace DotNet11Lab.Core.Labs.Libraries;

public sealed record AdapterComparison(string Scenario, Measurement Previous, Measurement New, string PreviousHash, string NewHash)
{
    public bool SameBytes => PreviousHash == NewHash;
}

public sealed record StreamObservation(string Step, string Observed);

public static class StreamAdapters
{
    public const int MaxPayloadBytes = 8 * 1024 * 1024;

    // A typical consumer that only accepts a Stream: integrity checksum of a payload.
    private static string Checksum(Stream stream)
    {
        Span<byte> hash = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(stream, hash);
        return Convert.ToHexString(hash[..8]);
    }

    // <snippet:Libraries.ReadOnlyMemoryStream>
    // A message body that is a slice of a larger receive buffer.
    public static string ChecksumBody(ReadOnlyMemory<byte> body)
    {
        using var stream = new ReadOnlyMemoryStream(body);   // .NET 11: a view, no copy
        return Checksum(stream);
    }

    public static string ChecksumText(string json)
    {
        using var stream = new StringStream(json, Encoding.UTF8);   // .NET 11: encodes lazily while reading
        return Checksum(stream);
    }

    public static string ChecksumSegments(ReadOnlySequence<byte> pipeData)
    {
        using var stream = new ReadOnlySequenceStream(pipeData);   // .NET 11: walks the segments in place
        return Checksum(stream);
    }
    // </snippet:Libraries.ReadOnlyMemoryStream>

    // <snippet:Libraries.LegacyMemoryStream>
    public static string LegacyChecksumBody(ReadOnlyMemory<byte> body)
    {
        using var stream = new MemoryStream(body.ToArray());   // copies the whole slice
        return Checksum(stream);
    }

    public static string LegacyChecksumText(string json)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));   // encodes everything up front
        return Checksum(stream);
    }

    public static string LegacyChecksumSegments(ReadOnlySequence<byte> pipeData)
    {
        using var stream = new MemoryStream(pipeData.ToArray());   // flattens every segment into one array
        return Checksum(stream);
    }
    // </snippet:Libraries.LegacyMemoryStream>

    public static IReadOnlyList<AdapterComparison> Compare(int payloadBytes, int iterations, CancellationToken cancellationToken)
    {
        payloadBytes = Math.Clamp(payloadBytes, 1_024, MaxPayloadBytes);
        iterations = Math.Clamp(iterations, 1, 200);

        var json = Encoding.UTF8.GetString(LibrarySampleData.Generate(SampleKind.JsonTransactionLog, payloadBytes));
        var utf8 = Encoding.UTF8.GetBytes(json);
        // The body sits in the middle of a bigger receive buffer, as it would in a socket/pipe reader.
        var receive = new byte[utf8.Length + 512];
        utf8.CopyTo(receive, 256);
        ReadOnlyMemory<byte> body = receive.AsMemory(256, utf8.Length);
        var sequence = Segments(utf8, segmentSize: 16 * 1024);

        return
        [
            Run("ReadOnlyMemory<byte> slice", iterations, () => LegacyChecksumBody(body), () => ChecksumBody(body), cancellationToken),
            Run("string (UTF-16) → UTF-8 stream", iterations, () => LegacyChecksumText(json), () => ChecksumText(json), cancellationToken),
            Run($"ReadOnlySequence<byte> ({SegmentCount(sequence)} segments)", iterations,
                () => LegacyChecksumSegments(sequence), () => ChecksumSegments(sequence), cancellationToken),
        ];
    }

    private static AdapterComparison Run(string scenario, int iterations, Func<string> previous, Func<string> current, CancellationToken cancellationToken)
    {
        var previousHash = previous();
        var newHash = current();
        var mPrevious = Measure.Run("MemoryStream + copy", iterations, () => previous(), cancellationToken);
        var mNew = Measure.Run(".NET 11 adapter", iterations, () => current(), cancellationToken);
        return new(scenario, mPrevious, mNew, previousHash, newHash);
    }

    private static int SegmentCount(ReadOnlySequence<byte> sequence)
    {
        var n = 0;
        foreach (var _ in sequence) n++;
        return n;
    }

    /// <summary>Builds a multi-segment sequence, like the one a PipeReader hands you.</summary>
    public static ReadOnlySequence<byte> Segments(byte[] data, int segmentSize)
    {
        if (data.Length <= segmentSize) return new ReadOnlySequence<byte>(data);
        Segment? first = null, last = null;
        for (var offset = 0; offset < data.Length; offset += segmentSize)
        {
            var chunk = data.AsMemory(offset, Math.Min(segmentSize, data.Length - offset));
            var segment = new Segment(chunk, last?.RunningIndex + last?.Memory.Length ?? 0);
            if (last is null) first = segment; else last.SetNext(segment);
            last = segment;
        }
        return new ReadOnlySequence<byte>(first!, 0, last!, last!.Memory.Length);
    }

    private sealed class Segment : ReadOnlySequenceSegment<byte>
    {
        public Segment(ReadOnlyMemory<byte> memory, long runningIndex)
        {
            Memory = memory;
            RunningIndex = runningIndex;
        }

        public void SetNext(Segment next) => Next = next;
    }

    // <snippet:Libraries.WritableMemoryStream>
    // Write a settlement record into a caller-provided, fixed-size buffer (e.g. a slice of a pooled array).
    public static IReadOnlyList<StreamObservation> WriteIntoFixedBuffer(int capacity, int recordBytes)
    {
        capacity = Math.Clamp(capacity, 1, 1 << 20);
        recordBytes = Math.Clamp(recordBytes, 0, 1 << 20);
        var rented = ArrayPool<byte>.Shared.Rent(capacity + 16);
        try
        {
            Memory<byte> window = rented.AsMemory(8, capacity);    // not a whole array: MemoryStream can't wrap it directly
            window.Span.Fill(0xAA);
            var record = Enumerable.Repeat((byte)'R', recordBytes).ToArray();
            var log = new List<StreamObservation>();

            using var stream = new WritableMemoryStream(window);
            log.Add(new("new WritableMemoryStream(window)", $"Length = {stream.Length}, Position = {stream.Position}, CanSeek = {stream.CanSeek}"));
            try
            {
                stream.Write(record);
                log.Add(new($"Write({recordBytes} bytes)", $"OK. Position = {stream.Position}, Length = {stream.Length}"));
                stream.SetLength(stream.Position);   // trim the logical length to what was written
                log.Add(new("SetLength(Position)", $"Length = {stream.Length}"));
            }
            catch (NotSupportedException ex)
            {
                var untouched = window.Span.IndexOfAnyExcept((byte)0xAA) < 0;
                log.Add(new($"Write({recordBytes} bytes)", $"{ex.GetType().Name}: {ex.Message}"));
                log.Add(new("After the failed write", $"Position = {stream.Position}; buffer untouched = {untouched}"));
            }
            return log;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }
    // </snippet:Libraries.WritableMemoryStream>

    // <snippet:Libraries.LegacyWritableMemoryStream>
    // .NET 10: a fixed MemoryStream needs an array, so a Memory<byte> must be array-backed to be wrapped.
    public static IReadOnlyList<StreamObservation> LegacyWriteIntoFixedBuffer(int capacity, int recordBytes)
    {
        capacity = Math.Clamp(capacity, 1, 1 << 20);
        recordBytes = Math.Clamp(recordBytes, 0, 1 << 20);
        Memory<byte> window = new byte[capacity + 16].AsMemory(8, capacity);
        var log = new List<StreamObservation>();
        if (!System.Runtime.InteropServices.MemoryMarshal.TryGetArray<byte>(window, out var segment))
            return [new("TryGetArray", "Not array-backed: fall back to a copy")];

        using var stream = new MemoryStream(segment.Array!, segment.Offset, segment.Count, writable: true);
        log.Add(new("new MemoryStream(array, offset, count)", $"Length = {stream.Length}, Position = {stream.Position}"));
        try
        {
            stream.Write(Enumerable.Repeat((byte)'R', recordBytes).ToArray());
            log.Add(new($"Write({recordBytes} bytes)", $"OK. Position = {stream.Position}, Length = {stream.Length}"));
        }
        catch (NotSupportedException ex)
        {
            log.Add(new($"Write({recordBytes} bytes)", $"{ex.GetType().Name}: {ex.Message}"));
        }
        return log;
    }
    // </snippet:Libraries.LegacyWritableMemoryStream>
}
