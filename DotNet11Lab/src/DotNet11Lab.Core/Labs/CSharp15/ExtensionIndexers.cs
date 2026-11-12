namespace DotNet11Lab.Core.Labs.CSharp15;

public sealed record OrderLine(string Sku, string Description, int Quantity, decimal UnitPrice)
{
    public decimal Total => Quantity * UnitPrice;
}

/// <summary>A type from "someone else's" library: it exposes its lines but has no indexer.</summary>
public sealed class CustomerOrder(string id, IEnumerable<OrderLine> lines)
{
    public string Id { get; } = id;
    public IReadOnlyList<OrderLine> Lines { get; } = [.. lines];
}

/// <summary>A type that already has an int indexer, used to show that the instance indexer wins.</summary>
public sealed class PickList(IEnumerable<string> skus)
{
    private readonly string[] _skus = [.. skus];
    public string this[int position] => $"instance indexer → {_skus[position]}";
    public int Count => _skus.Length;
}

// <snippet:CSharp15.ExtensionIndexer>
public static class OrderIndexers
{
    extension(CustomerOrder order)
    {
        // order["SKU-123"] — reads like a built-in member, works on a type we cannot modify.
        public OrderLine? this[string sku] =>
            order.Lines.FirstOrDefault(l => string.Equals(l.Sku, sku, StringComparison.OrdinalIgnoreCase));

        // Overloads work as usual: order[^1] for the last line.
        public OrderLine this[Index index] => order.Lines[index];
    }

    extension(PickList list)
    {
        // Never chosen for list[0]: PickList already has an applicable instance indexer.
        public string this[int position] => "extension indexer";
    }
}
// </snippet:CSharp15.ExtensionIndexer>

// <snippet:CSharp15.LegacyExtensionIndexer>
public static class LegacyOrderExtensions
{
    // C# 14: extension *methods* only, so the call site reads order.GetLine("SKU-123").
    public static OrderLine? GetLine(this CustomerOrder order, string sku) =>
        order.Lines.FirstOrDefault(l => string.Equals(l.Sku, sku, StringComparison.OrdinalIgnoreCase));
}
// </snippet:CSharp15.LegacyExtensionIndexer>

public static class SampleOrders
{
    public static CustomerOrder Create() => new("SO-20481",
    [
        new("KB-MX-01", "Mechanical keyboard", 2, 129.00m),
        new("MS-ERG-07", "Ergonomic mouse", 2, 59.50m),
        new("MN-27-4K", "27\" 4K monitor", 1, 389.99m),
        new("CB-USBC-2M", "USB-C cable 2 m", 4, 12.90m),
    ]);
}
