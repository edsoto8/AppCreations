using System.Collections.Concurrent;

namespace DotNet11Lab.Api.Commerce;

/// <summary>
/// Thread-safe in-memory order store. Seeded with three fixed orders so the playground presets are repeatable;
/// orders created through checkout are capped at <see cref="MaxCreatedOrders"/> (oldest evicted first).
/// </summary>
public sealed class OrderStore
{
    public const int MaxCreatedOrders = 500;

    private readonly ConcurrentDictionary<string, OrderView> _orders = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentQueue<string> _created = new();
    private int _sequence = 5000;

    public OrderStore()
    {
        var seededAt = new DateTimeOffset(2026, 11, 1, 9, 30, 0, TimeSpan.Zero);
        foreach (var order in Seed(seededAt)) _orders[order.OrderId] = order;
    }

    /// <summary>Pending, EUR 128.50: a payment for exactly this amount succeeds.</summary>
    public const string PendingOrderId = "ord_1001";
    /// <summary>Already paid: paying again is a 409 Conflict.</summary>
    public const string PaidOrderId = "ord_1002";

    public OrderView? Find(string orderId) => _orders.GetValueOrDefault(orderId);

    public OrderView Create(string customerId, string currency, IReadOnlyList<OrderLineView> lines, decimal discount, string? coupon, DateTimeOffset now)
    {
        var id = $"ord_{Interlocked.Increment(ref _sequence)}";
        var subtotal = lines.Sum(l => l.LineTotal);
        var order = new OrderView(id, customerId, currency, lines, subtotal, discount, subtotal - discount, coupon, OrderStatus.Pending, now);
        _orders[id] = order;
        _created.Enqueue(id);
        while (_created.Count > MaxCreatedOrders && _created.TryDequeue(out var oldest)) _orders.TryRemove(oldest, out _);
        return order;
    }

    private static IEnumerable<OrderView> Seed(DateTimeOffset at)
    {
        OrderLineView[] lines1 = [new("SKU-KEYBOARD", "Mechanical keyboard", 1, 89.00m, 89.00m), new("SKU-MOUSE", "Wireless mouse", 1, 39.50m, 39.50m)];
        yield return new OrderView(PendingOrderId, "cus_1001", "EUR", lines1, 128.50m, 0m, 128.50m, null, OrderStatus.Pending, at);
        OrderLineView[] lines2 = [new("SKU-MONITOR", "27\" 4K monitor", 1, 249.00m, 249.00m)];
        yield return new OrderView(PaidOrderId, "cus_1002", "USD", lines2, 249.00m, 0m, 249.00m, null, OrderStatus.Paid, at);
        OrderLineView[] lines3 = [new("SKU-CABLE", "USB-C cable", 3, 9.99m, 29.97m)];
        yield return new OrderView("ord_1003", "cus_1001", "GBP", lines3, 29.97m, 0m, 29.97m, null, OrderStatus.Pending, at);
    }
}
