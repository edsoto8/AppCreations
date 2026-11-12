using System.Text;
using System.Text.Json;

namespace DotNet11Lab.Core.Labs.Libraries;

public sealed record JsonLinesResult(
    int Items,
    long Bytes,
    string Preview,
    bool IdenticalToLegacy,
    int ReadBack,
    decimal ReadBackTotal,
    string ArrayModePreview,
    long LegacyBytes);

public static class JsonLines
{
    public const int MaxItems = 100_000;

    // <snippet:Libraries.JsonLinesWrite>
    // .NET 11: one call streams an IAsyncEnumerable as JSON Lines (one compact value + '\n' per item).
    public static Task WriteAsync(Stream destination, IAsyncEnumerable<TransactionEvent> events, CancellationToken cancellationToken) =>
        JsonSerializer.SerializeAsyncEnumerable(
            destination, events, LibrariesJsonContext.Default.TransactionEvent, topLevelValues: true, cancellationToken);

    // Reading JSON Lines back (available since .NET 9) — also streaming, one value at a time.
    public static IAsyncEnumerable<TransactionEvent?> ReadAsync(Stream source, CancellationToken cancellationToken) =>
        JsonSerializer.DeserializeAsyncEnumerable(
            source, LibrariesJsonContext.Default.TransactionEvent, topLevelValues: true, cancellationToken);
    // </snippet:Libraries.JsonLinesWrite>

    // <snippet:Libraries.LegacyJsonLinesWrite>
    // .NET 10: a hand-written loop; easy to forget the final newline, flushing, or to pass WriteIndented options.
    public static async Task LegacyWriteAsync(Stream destination, IAsyncEnumerable<TransactionEvent> events, CancellationToken cancellationToken)
    {
        await foreach (var e in events.WithCancellation(cancellationToken))
        {
            await JsonSerializer.SerializeAsync(destination, e, LibrariesJsonContext.Default.TransactionEvent, cancellationToken);
            destination.WriteByte((byte)'\n');
        }
        await destination.FlushAsync(cancellationToken);
    }
    // </snippet:Libraries.LegacyJsonLinesWrite>

    public static async Task<JsonLinesResult> RunAsync(int items, CancellationToken cancellationToken)
    {
        items = Math.Clamp(items, 1, MaxItems);

        using var jsonl = new MemoryStream();
        await WriteAsync(jsonl, LibrarySampleData.TransactionsAsync(items, cancellationToken: cancellationToken), cancellationToken);

        using var legacy = new MemoryStream();
        await LegacyWriteAsync(legacy, LibrarySampleData.TransactionsAsync(items, cancellationToken: cancellationToken), cancellationToken);

        // Default topLevelValues: false — the same method writes one JSON array instead.
        using var array = new MemoryStream();
        await JsonSerializer.SerializeAsyncEnumerable(array, LibrarySampleData.TransactionsAsync(Math.Min(items, 3), cancellationToken: cancellationToken),
            LibrariesJsonContext.Default.TransactionEvent, topLevelValues: false, cancellationToken);

        jsonl.Position = 0;
        var count = 0;
        var total = 0m;
        await foreach (var e in ReadAsync(jsonl, cancellationToken))
        {
            count++;
            total += e?.Amount ?? 0;
        }

        return new(
            items,
            jsonl.Length,
            FirstLines(jsonl.ToArray(), 5),
            jsonl.ToArray().AsSpan().SequenceEqual(legacy.ToArray()),
            count,
            total,
            Encoding.UTF8.GetString(array.ToArray()),
            legacy.Length);
    }

    private static string FirstLines(byte[] utf8, int lines)
    {
        var text = Encoding.UTF8.GetString(utf8.AsSpan(0, Math.Min(utf8.Length, 4_096)));
        var parts = text.Split('\n');
        return string.Join('\n', parts.Take(lines)) + (parts.Length > lines ? "\n…" : "");
    }
}
