using System.Collections.Frozen;
using System.Globalization;
using System.Text;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

/// <summary>Deterministic inputs (fixed seeds) so every run, page and benchmark sees identical data.</summary>
public static class WorkloadData
{
    public const int DefaultSeed = 42;

    /// <summary>Comma-separated integers, e.g. <c>"417,92,7,..."</c>.</summary>
    public static string CreateCsvNumbers(int count, int seed = DefaultSeed)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);
        var random = new Random(seed);
        var sb = new StringBuilder(count * 4);
        for (var i = 0; i < count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(random.Next(0, 1000).ToString(CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    /// <summary>UTF-8 ledger text: one <c>id,account,amountCents</c> line per entry, newline-terminated.</summary>
    public static byte[] CreateLedger(int lines, int seed = DefaultSeed)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(lines, 1);
        var random = new Random(seed);
        var sb = new StringBuilder(lines * 24);
        for (var i = 0; i < lines; i++)
        {
            sb.Append(i.ToString(CultureInfo.InvariantCulture)).Append(",ACC-")
              .Append((i % 97).ToString("000", CultureInfo.InvariantCulture)).Append(',')
              .Append(random.Next(-50_000, 250_000).ToString(CultureInfo.InvariantCulture)).Append('\n');
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    /// <summary>The expected total of <see cref="CreateLedger"/>, computed independently of the workloads.</summary>
    public static long ExpectedLedgerTotal(int lines, int seed = DefaultSeed)
    {
        var random = new Random(seed);
        long total = 0;
        for (var i = 0; i < lines; i++) total += random.Next(-50_000, 250_000);
        return total;
    }

    public static List<Order> CreateOrders(int count, int seed = DefaultSeed)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);
        var random = new Random(seed);
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var orders = new List<Order>(count);
        for (var i = 0; i < count; i++)
        {
            var lines = new List<OrderLine>();
            var lineCount = random.Next(1, 6);
            for (var l = 0; l < lineCount; l++)
            {
                lines.Add(new OrderLine($"SKU-{random.Next(1000, 9999)}", random.Next(1, 10), random.Next(100, 50_000) / 100m));
            }
            orders.Add(new Order(i + 1, $"customer-{random.Next(1, 500):000}", start.AddMinutes(random.Next(0, 500_000)),
                lines.Sum(x => x.Quantity * x.UnitPrice), lines));
        }
        return orders;
    }

    public static int[] CreateIntegers(int count, int seed = DefaultSeed)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);
        var random = new Random(seed);
        var values = new int[count];
        for (var i = 0; i < values.Length; i++) values[i] = random.Next(0, 10_000);
        return values;
    }

    /// <summary>A map with <paramref name="size"/> string keys and <paramref name="lookups"/> probes (about 3 in 4 hit).</summary>
    public static (Dictionary<string, int> Map, FrozenDictionary<string, int> Frozen, string[] Probes) CreateLookup(int size, int lookups, int seed = DefaultSeed)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(size, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(lookups, 1);
        var random = new Random(seed);
        var map = new Dictionary<string, int>(size, StringComparer.Ordinal);
        for (var i = 0; i < size; i++) map[$"product-{i:00000}"] = i;
        var probes = new string[lookups];
        for (var i = 0; i < probes.Length; i++)
        {
            var id = random.Next(0, size + size / 3);
            probes[i] = $"product-{id:00000}";
        }
        return (map, map.ToFrozenDictionary(StringComparer.Ordinal), probes);
    }
}
