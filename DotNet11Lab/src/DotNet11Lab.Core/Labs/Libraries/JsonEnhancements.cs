using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace DotNet11Lab.Core.Labs.Libraries;

// <snippet:Libraries.ClosedPaymentEvents>
public closed record PaymentEvent(string PaymentId);
public sealed record PaymentAuthorized(string PaymentId, decimal Amount) : PaymentEvent(PaymentId);
public sealed record PaymentCaptured(string PaymentId, decimal Amount, DateOnly SettlementDate) : PaymentEvent(PaymentId);
public sealed record PaymentRefunded(string PaymentId, decimal Amount, string Reason) : PaymentEvent(PaymentId);
// </snippet:Libraries.ClosedPaymentEvents>

public sealed record WebhookDelivery(string EventId, int Attempt, DateTimeOffset ReceivedAt);

public sealed record PolymorphismDemo(string WithoutInference, string WithInference, string RoundTripped);

public sealed record TypeInfoDemo(string Kind, IReadOnlyList<string> Properties, string Json);

public sealed record DedupeDemo(int Deliveries, int UniqueWithKeyComparer, int UniqueWithLegacyComparer, int UniqueWithRecordEquality);

public static class JsonEnhancements
{
    public static IReadOnlyList<PaymentEvent> SampleEvents { get; } =
    [
        new PaymentAuthorized("pay_481", 120.00m),
        new PaymentCaptured("pay_481", 120.00m, new DateOnly(2026, 11, 13)),
        new PaymentRefunded("pay_481", 20.00m, "Item returned"),
    ];

    // <snippet:Libraries.InferClosedPolymorphism>
    public static PolymorphismDemo Polymorphism()
    {
        var plain = new JsonSerializerOptions();
        var inferred = new JsonSerializerOptions { InferClosedTypePolymorphism = true };   // .NET 11

        var withInference = JsonSerializer.Serialize(SampleEvents, inferred);
        var back = JsonSerializer.Deserialize<List<PaymentEvent>>(withInference, inferred)!;

        return new(
            JsonSerializer.Serialize(SampleEvents, plain),   // declared type only: derived properties are lost
            withInference,                                    // "$type" discriminators from the closed list
            string.Join(", ", back.Select(e => e.GetType().Name)));
    }
    // </snippet:Libraries.InferClosedPolymorphism>

    // <snippet:Libraries.PascalCase>
    public static IReadOnlyList<(string Input, string Output)> PascalCaseNames(IEnumerable<string> names) =>
        names.Select(n => (n, JsonNamingPolicy.PascalCase.ConvertName(n))).ToList();

    // Normalizing metadata keys that arrive from several upstream systems.
    public static string NormalizeMetadata(Dictionary<string, string> metadata) =>
        JsonSerializer.Serialize(metadata, new JsonSerializerOptions { DictionaryKeyPolicy = JsonNamingPolicy.PascalCase, WriteIndented = true });
    // </snippet:Libraries.PascalCase>

    // <snippet:Libraries.GetTypeInfoGeneric>
    public static TypeInfoDemo InspectContract()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { TypeInfoResolver = LibrariesJsonContext.Default };

        JsonTypeInfo<TransactionEvent> info = options.GetTypeInfo<TransactionEvent>();   // .NET 11: typed, no cast

        var sample = LibrarySampleData.Transactions(1).Single();
        return new(info.Kind.ToString(), info.Properties.Select(p => $"{p.Name}: {p.PropertyType.Name}").ToList(),
            JsonSerializer.Serialize(sample, info));
    }
    // </snippet:Libraries.GetTypeInfoGeneric>

    // <snippet:Libraries.LegacyGetTypeInfo>
    public static JsonTypeInfo<TransactionEvent> LegacyInspectContract(JsonSerializerOptions options) =>
        (JsonTypeInfo<TransactionEvent>)options.GetTypeInfo(typeof(TransactionEvent));   // non-generic + cast
    // </snippet:Libraries.LegacyGetTypeInfo>

    // <snippet:Libraries.EqualityComparerCreate>
    // Webhooks are delivered at-least-once: retries carry the same EventId with a new Attempt number.
    public static IReadOnlyList<WebhookDelivery> UniqueEvents(IEnumerable<WebhookDelivery> deliveries) =>
        deliveries.Distinct(EqualityComparer<WebhookDelivery>.Create(d => d?.EventId, StringComparer.Ordinal)).ToList();
    // </snippet:Libraries.EqualityComparerCreate>

    // <snippet:Libraries.LegacyEqualityComparer>
    // .NET 8–10: Create(equals, getHashCode) — two lambdas that must stay consistent with each other.
    public static IReadOnlyList<WebhookDelivery> LegacyUniqueEvents(IEnumerable<WebhookDelivery> deliveries) =>
        deliveries.Distinct(EqualityComparer<WebhookDelivery>.Create(
            (a, b) => string.Equals(a?.EventId, b?.EventId, StringComparison.Ordinal),
            d => StringComparer.Ordinal.GetHashCode(d.EventId))).ToList();
    // </snippet:Libraries.LegacyEqualityComparer>

    public static IReadOnlyList<WebhookDelivery> SampleDeliveries(int events, int seed = 5)
    {
        events = Math.Clamp(events, 1, 10_000);
        var random = new Random(seed);
        var start = new DateTimeOffset(2026, 11, 12, 9, 0, 0, TimeSpan.Zero);
        var list = new List<WebhookDelivery>();
        for (var i = 0; i < events; i++)
        {
            var attempts = random.Next(10) < 3 ? random.Next(2, 4) : 1;    // ~30 % of events are retried
            for (var a = 1; a <= attempts; a++)
                list.Add(new($"evt_{i:00000}", a, start.AddSeconds(i * 3 + a * 30)));
        }
        return list;
    }

    public static DedupeDemo Dedupe(int events)
    {
        var deliveries = SampleDeliveries(events);
        return new(deliveries.Count, UniqueEvents(deliveries).Count, LegacyUniqueEvents(deliveries).Count, deliveries.Distinct().Count());
    }
}
