using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

public sealed record OrderLine(string Sku, int Quantity, decimal UnitPrice);

public sealed record Order(int Id, string Customer, DateTime CreatedUtc, decimal Total, List<OrderLine> Lines);

// <snippet:Perf.JsonContext>
// The source generator emits serialization code for these types at compile time (trim- and AOT-safe).
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(List<Order>))]
public sealed partial class PerfJsonContext : JsonSerializerContext;
// </snippet:Perf.JsonContext>

/// <summary>Reflection-based vs source-generated System.Text.Json. Shared with DotNet11Lab.Benchmarks.</summary>
public static class JsonWorkloads
{
    // <snippet:Perf.JsonReflection>
    // Metadata is built by reflection on first use and cached in the options instance.
    private static readonly JsonSerializerOptions ReflectionOptions = new(JsonSerializerDefaults.Web)
    {
        TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
    };

    public static string SerializeWithReflection(List<Order> orders) =>
        JsonSerializer.Serialize(orders, ReflectionOptions);

    public static List<Order> DeserializeWithReflection(string json) =>
        JsonSerializer.Deserialize<List<Order>>(json, ReflectionOptions) ?? [];
    // </snippet:Perf.JsonReflection>

    // <snippet:Perf.JsonSourceGen>
    public static string SerializeWithSourceGen(List<Order> orders) =>
        JsonSerializer.Serialize(orders, PerfJsonContext.Default.ListOrder);

    public static List<Order> DeserializeWithSourceGen(string json) =>
        JsonSerializer.Deserialize(json, PerfJsonContext.Default.ListOrder) ?? [];
    // </snippet:Perf.JsonSourceGen>
}
