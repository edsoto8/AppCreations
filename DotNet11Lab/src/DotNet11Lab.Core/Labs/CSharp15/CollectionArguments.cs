using DotNet11Lab.Core.Diagnostics;

namespace DotNet11Lab.Core.Labs.CSharp15;

public sealed record SkuDedupeResult(IReadOnlyList<string> Input, IReadOnlyList<string> Unique, IReadOnlyList<string> CaseSensitiveUnique);

public sealed record CapacityVariant(string Code, int Capacity, Measurement Measurement);

public sealed record CapacityComparison(int Items, int ExpectedItems, IReadOnlyList<CapacityVariant> Variants);

public static class CollectionArguments
{
    public const int MaxItems = 1_000_000;

    // <snippet:CSharp15.DedupeSkus>
    public static HashSet<string> UniqueSkus(IEnumerable<string> scanned) =>
        [with(StringComparer.OrdinalIgnoreCase), .. scanned.Select(s => s.Trim()).Where(s => s.Length > 0)];
    // </snippet:CSharp15.DedupeSkus>

    // <snippet:CSharp15.LegacyDedupeSkus>
    public static HashSet<string> LegacyUniqueSkus(IEnumerable<string> scanned)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in scanned)
        {
            var sku = s.Trim();
            if (sku.Length > 0) set.Add(sku);
        }
        return set;
    }
    // </snippet:CSharp15.LegacyDedupeSkus>

    public static SkuDedupeResult Dedupe(string text)
    {
        var input = text.Split([',', '\n', ';'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Take(10_000).ToList();
        HashSet<string> caseSensitive = [.. input];   // no 'with': default (ordinal, case-sensitive) comparer
        return new(input, [.. UniqueSkus(input)], [.. caseSensitive]);
    }

    // <snippet:CSharp15.PresizedList>
    // 'open' is a lazy query, so the compiler cannot know its count up front.
    public static List<decimal> LinesPresized(IEnumerable<decimal> open, int expected) =>
        [with(capacity: expected), .. open];

    public static List<decimal> LinesDefault(IEnumerable<decimal> open) =>
        [.. open];   // the runtime buffers the items, then copies them into an exactly-sized list

    public static HashSet<string> CustomerIds(IEnumerable<string> ids, int expected) =>
        [with(capacity: expected, comparer: StringComparer.OrdinalIgnoreCase), .. ids];
    // </snippet:CSharp15.PresizedList>

    // <snippet:CSharp15.LegacyPresizedList>
    // C# 14: collection expressions could not take arguments, so presizing meant falling back to a constructor.
    public static List<decimal> LegacyLinesPresized(IEnumerable<decimal> open, int expected)
    {
        var list = new List<decimal>(expected);
        list.AddRange(open);
        return list;
    }

    public static List<decimal> LegacyLinesGrowing(IEnumerable<decimal> open)
    {
        var list = new List<decimal>();
        foreach (var amount in open) list.Add(amount);   // grows 4 → 8 → 16 → … copying each time
        return list;
    }
    // </snippet:CSharp15.LegacyPresizedList>

    /// <summary>
    /// Builds a list of <paramref name="items"/> amounts from a lazy query four ways and measures each.
    /// <paramref name="expectedItems"/> is the capacity hint (e.g. a page size known from the API contract).
    /// </summary>
    public static CapacityComparison CompareCapacity(int items, int expectedItems, int iterations, CancellationToken cancellationToken)
    {
        items = Math.Clamp(items, 1, MaxItems);
        expectedItems = Math.Clamp(expectedItems, 0, MaxItems);
        iterations = Math.Clamp(iterations, 1, 200);
        // Where(...) hides the count, which is exactly the case where presizing helps.
        IEnumerable<decimal> Source() => Enumerable.Range(0, items).Select(i => i * 1.25m).Where(_ => true);

        (string Code, Func<List<decimal>> Build)[] variants =
        [
            ("[with(capacity: n), .. query]", () => LinesPresized(Source(), expectedItems)),
            ("[.. query]", () => LinesDefault(Source())),
            ("new List(n) + AddRange", () => LegacyLinesPresized(Source(), expectedItems)),
            ("new List() + Add loop", () => LegacyLinesGrowing(Source())),
        ];
        return new(items, expectedItems, variants
            .Select(v => new CapacityVariant(v.Code, v.Build().Capacity, Measure.Run(v.Code, iterations, () => v.Build(), cancellationToken)))
            .ToList());
    }
}
