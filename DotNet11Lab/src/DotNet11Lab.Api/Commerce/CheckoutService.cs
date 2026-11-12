namespace DotNet11Lab.Api.Commerce;

public sealed record StockConflict(string Sku, int Requested, int Available);

/// <summary>Result of placing an order once the request is known to be valid.</summary>
public union PlaceOrderResult(OrderView, StockConflict);

/// <summary>Prices and stores an order. Shared by the .NET 11 endpoint and the .NET 10-style endpoint.</summary>
public sealed class CheckoutService(CommerceDirectory directory, OrderStore orders, TimeProvider time)
{
    public async Task<PlaceOrderResult> PlaceOrderAsync(
        string customerId, string currency, IEnumerable<(string Sku, int Quantity)> requestedLines, string? couponCode, CancellationToken cancellationToken)
    {
        var lines = new List<OrderLineView>();
        foreach (var group in requestedLines.GroupBy(l => l.Sku.ToUpperInvariant()))
        {
            var product = await directory.FindProductAsync(group.Key, cancellationToken)
                ?? throw new InvalidOperationException($"SKU {group.Key} was accepted by validation but is missing from the catalog.");
            var quantity = group.Sum(l => l.Quantity);
            if (quantity > product.InStock) return new StockConflict(product.Sku, quantity, product.InStock);
            lines.Add(new OrderLineView(product.Sku, product.Name, quantity, product.UnitPrice, product.UnitPrice * quantity));
        }

        var discount = 0m;
        string? appliedCoupon = null;
        if (couponCode is { Length: > 0 } && await directory.FindCouponAsync(couponCode, cancellationToken) is { } coupon)
        {
            discount = Math.Round(lines.Sum(l => l.LineTotal) * coupon.PercentOff / 100m, 2, MidpointRounding.ToEven);
            appliedCoupon = coupon.Code;
        }

        return orders.Create(customerId.ToLowerInvariant(), currency, lines, discount, appliedCoupon, time.GetUtcNow());
    }
}
