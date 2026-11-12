using System.Collections.Frozen;

namespace DotNet11Lab.Api.Commerce;

public enum CustomerTier { Standard, Gold }

public sealed record Customer(string Id, string Name, CustomerTier Tier, string Country, int PreviousOrders, bool Suspended);

public sealed record Coupon(string Code, decimal PercentOff, DateOnly ExpiresOn, bool FirstOrderOnly, CustomerTier? RequiredTier);

public sealed record Product(string Sku, string Name, decimal UnitPrice, int InStock);

/// <summary>Tunable latency for the simulated remote lookups (tests set it to zero).</summary>
public sealed class CommerceDirectoryOptions
{
    public TimeSpan LookupLatency { get; set; } = TimeSpan.FromMilliseconds(35);
}

/// <summary>
/// In-memory stand-in for the customer, coupon and catalog services a real checkout would call over the network.
/// Every lookup is asynchronous, waits a configurable latency and honours the caller's <see cref="CancellationToken"/>,
/// which is exactly the kind of check that used to be impossible inside a DataAnnotations attribute.
/// </summary>
public sealed class CommerceDirectory(CommerceDirectoryOptions options, TimeProvider time)
{
    private static readonly FrozenDictionary<string, Customer> Customers = new Customer[]
    {
        new("cus_1001", "Ada Lovelace", CustomerTier.Gold, "GB", PreviousOrders: 14, Suspended: false),
        new("cus_1002", "Grace Hopper", CustomerTier.Standard, "US", PreviousOrders: 0, Suspended: false),
        new("cus_1003", "Alan Turing", CustomerTier.Standard, "GB", PreviousOrders: 3, Suspended: true),
    }.ToFrozenDictionary(c => c.Id, StringComparer.OrdinalIgnoreCase);

    private static readonly FrozenDictionary<string, Coupon> Coupons = new Coupon[]
    {
        new("WELCOME10", 10m, new DateOnly(2099, 12, 31), FirstOrderOnly: true, RequiredTier: null),
        new("GOLD20", 20m, new DateOnly(2099, 12, 31), FirstOrderOnly: false, RequiredTier: CustomerTier.Gold),
        new("SPRING5", 5m, new DateOnly(2099, 6, 30), FirstOrderOnly: false, RequiredTier: null),
        new("EXPIRED24", 15m, new DateOnly(2024, 12, 31), FirstOrderOnly: false, RequiredTier: null),
    }.ToFrozenDictionary(c => c.Code, StringComparer.OrdinalIgnoreCase);

    private static readonly FrozenDictionary<string, Product> Products = new Product[]
    {
        new("SKU-KEYBOARD", "Mechanical keyboard", 89.00m, InStock: 120),
        new("SKU-MOUSE", "Wireless mouse", 39.50m, InStock: 300),
        new("SKU-MONITOR", "27\" 4K monitor", 249.00m, InStock: 3),
        new("SKU-CABLE", "USB-C cable", 9.99m, InStock: 1000),
    }.ToFrozenDictionary(p => p.Sku, StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyCollection<Product> Catalog => Products.Values;

    public DateOnly Today => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);

    public async Task<Customer?> FindCustomerAsync(string id, CancellationToken cancellationToken)
    {
        await SimulateLatencyAsync(cancellationToken);
        return Customers.GetValueOrDefault(id);
    }

    public async Task<Coupon?> FindCouponAsync(string code, CancellationToken cancellationToken)
    {
        await SimulateLatencyAsync(cancellationToken);
        return Coupons.GetValueOrDefault(code);
    }

    public async Task<Product?> FindProductAsync(string sku, CancellationToken cancellationToken)
    {
        await SimulateLatencyAsync(cancellationToken);
        return Products.GetValueOrDefault(sku);
    }

    private Task SimulateLatencyAsync(CancellationToken cancellationToken) =>
        options.LookupLatency <= TimeSpan.Zero
            ? Task.CompletedTask
            : Task.Delay(options.LookupLatency, time, cancellationToken);
}
