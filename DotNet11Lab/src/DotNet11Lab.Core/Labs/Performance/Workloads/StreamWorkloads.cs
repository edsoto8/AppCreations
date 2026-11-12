using System.Buffers;
using System.Buffers.Text;
using System.Globalization;
using System.IO.Pipelines;
using System.Text;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

/// <summary>
/// Sums the amount column of a ledger with lines <c>id,account,amountCents</c>. Shared by the live page and
/// BenchmarkDotNet (linked file), so both measure the same code.
/// </summary>
public static class StreamWorkloads
{
    // <snippet:Perf.StreamReader>
    // A string per line, a string[] per line and a string per field.
    public static async Task<long> SumWithStreamReaderAsync(byte[] ledger, CancellationToken cancellationToken = default)
    {
        using var reader = new StreamReader(new MemoryStream(ledger), Encoding.UTF8);
        long total = 0;
        while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            if (line.Length == 0) continue;
            var fields = line.Split(',');
            total += long.Parse(fields[2], CultureInfo.InvariantCulture);
        }
        return total;
    }
    // </snippet:Perf.StreamReader>

    // <snippet:Perf.PipeReader>
    // Parses UTF-8 bytes in the pipe's pooled buffers: no per-line strings.
    public static async Task<long> SumWithPipeReaderAsync(byte[] ledger, CancellationToken cancellationToken = default)
    {
        var reader = PipeReader.Create(new MemoryStream(ledger));
        long total = 0;
        try
        {
            while (true)
            {
                ReadResult result = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                ReadOnlySequence<byte> buffer = result.Buffer;
                total += ParseCompleteLines(ref buffer, result.IsCompleted);
                reader.AdvanceTo(buffer.Start, buffer.End);
                if (result.IsCompleted) break;
            }
        }
        finally
        {
            await reader.CompleteAsync().ConfigureAwait(false);
        }
        return total;
    }

    private static long ParseCompleteLines(ref ReadOnlySequence<byte> buffer, bool isFinalBlock)
    {
        var lines = new SequenceReader<byte>(buffer);
        long total = 0;
        while (lines.TryReadTo(out ReadOnlySpan<byte> line, (byte)'\n'))
        {
            total += AmountOf(line);
        }
        if (isFinalBlock && !lines.End)
        {
            // Last line without a trailing newline.
            var rest = lines.UnreadSequence;
            total += AmountOf(rest.IsSingleSegment ? rest.FirstSpan : rest.ToArray());
            lines.AdvanceToEnd();
        }
        buffer = buffer.Slice(lines.Position);
        return total;
    }

    private static long AmountOf(ReadOnlySpan<byte> line)
    {
        line = line.TrimEnd((byte)'\r');
        if (line.IsEmpty) return 0;
        var comma = line.LastIndexOf((byte)',');
        return Utf8Parser.TryParse(line[(comma + 1)..], out long amount, out _)
            ? amount
            : throw new FormatException("Malformed ledger line.");
    }
    // </snippet:Perf.PipeReader>
}
