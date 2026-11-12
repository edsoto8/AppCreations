using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DotNet11Lab.Core.Labs.Libraries;

/// <summary>One entry of a payment platform's transaction log.</summary>
public sealed record TransactionEvent(
    string Id,
    DateTimeOffset Timestamp,
    string Account,
    string Type,
    decimal Amount,
    string Currency,
    string Status,
    string? Merchant);

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(TransactionEvent))]
[JsonSerializable(typeof(List<TransactionEvent>))]
public sealed partial class LibrariesJsonContext : JsonSerializerContext;

public enum SampleKind
{
    /// <summary>A JSON array of transaction events (typical API payload / export file).</summary>
    JsonTransactionLog,
    /// <summary>Plain-text application log lines.</summary>
    TextLog,
}

/// <summary>Deterministic, realistic data for the compression and JSON demos.</summary>
public static class LibrarySampleData
{
    public const int MaxBytes = 16 * 1024 * 1024;

    private static readonly string?[] Merchants =
        ["Contoso Coffee", "Fabrikam Fuel", "Northwind Grocers", "Adventure Works Outdoor", "Tailspin Air", "Litware Cloud", "Wingtip Books", null];
    private static readonly string[] Types = ["card_payment", "refund", "transfer", "fee", "chargeback"];
    private static readonly string[] Statuses = ["settled", "settled", "settled", "pending", "declined"];
    private static readonly string[] Currencies = ["USD", "EUR", "GBP"];

    public static IEnumerable<TransactionEvent> Transactions(int count, int seed = 11)
    {
        var random = new Random(seed);
        var start = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < count; i++)
        {
            yield return new TransactionEvent(
                $"tx_{seed:00}{i:0000000}",
                start.AddSeconds(i * 7 + random.Next(7)),
                $"ACC-{random.Next(1, 400):00000}",
                Types[random.Next(Types.Length)],
                Math.Round((decimal)(random.NextDouble() * 2_000), 2),
                Currencies[random.Next(Currencies.Length)],
                Statuses[random.Next(Statuses.Length)],
                Merchants[random.Next(Merchants.Length)]);
        }
    }

    public static async IAsyncEnumerable<TransactionEvent> TransactionsAsync(
        int count, int seed = 11, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (var tx in Transactions(count, seed))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (tx.Id.EndsWith("00", StringComparison.Ordinal)) await Task.Yield();   // behave like a real async source
            yield return tx;
        }
    }

    /// <summary>Approximately <paramref name="targetBytes"/> of realistic data.</summary>
    public static byte[] Generate(SampleKind kind, int targetBytes, int seed = 11)
    {
        targetBytes = Math.Clamp(targetBytes, 1_024, MaxBytes);
        return kind switch
        {
            SampleKind.JsonTransactionLog => JsonSerializer.SerializeToUtf8Bytes(
                Transactions(Math.Max(1, targetBytes / 190), seed).ToList(), LibrariesJsonContext.Default.ListTransactionEvent),
            SampleKind.TextLog => TextLog(targetBytes, seed),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
    }

    private static byte[] TextLog(int targetBytes, int seed)
    {
        var random = new Random(seed);
        var sb = new StringBuilder(targetBytes + 256);
        var time = new DateTime(2026, 11, 12, 8, 0, 0, DateTimeKind.Utc);
        string[] levels = ["INF", "INF", "INF", "DBG", "WRN", "ERR"];
        string[] messages =
        [
            "HTTP GET /api/orders/{0} responded 200 in {1} ms",
            "Payment {0} authorized for account ACC-{1:00000}",
            "Cache miss for key order:{0}; loading from database ({1} ms)",
            "Retrying outbound call to settlement gateway, attempt {1} for batch {0}",
            "Order {0} transitioned Submitted -> Paid",
        ];
        while (sb.Length < targetBytes)
        {
            time = time.AddMilliseconds(random.Next(1, 900));
            sb.Append(time.ToString("yyyy-MM-dd HH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture))
              .Append(" [").Append(levels[random.Next(levels.Length)]).Append("] ")
              .AppendFormat(System.Globalization.CultureInfo.InvariantCulture, messages[random.Next(messages.Length)], random.Next(10_000, 99_999), random.Next(1, 400))
              .Append('\n');
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    /// <summary>Many small, similar JSON documents — the case Zstandard dictionaries are designed for.</summary>
    public static IReadOnlyList<byte[]> SmallPayloads(int count, int seed = 21) =>
        Transactions(count, seed).Select(t => JsonSerializer.SerializeToUtf8Bytes(t, LibrariesJsonContext.Default.TransactionEvent)).ToList();
}
