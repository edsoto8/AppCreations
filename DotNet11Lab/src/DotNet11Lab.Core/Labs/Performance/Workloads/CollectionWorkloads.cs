using System.Collections.Frozen;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

/// <summary>LINQ chains vs loops and Dictionary vs FrozenDictionary lookups. Shared with DotNet11Lab.Benchmarks.</summary>
public static class CollectionWorkloads
{
    // <snippet:Perf.Linq>
    public static long SumWithLinq(int[] values) =>
        values.Where(v => v % 3 == 0).Select(v => (long)v * 2).Sum();
    // </snippet:Perf.Linq>

    // <snippet:Perf.Loop>
    public static long SumWithLoop(int[] values)
    {
        long sum = 0;
        foreach (var v in values)
        {
            if (v % 3 == 0) sum += (long)v * 2;
        }
        return sum;
    }
    // </snippet:Perf.Loop>

    // <snippet:Perf.Lookup>
    // Same loop, two dictionary types. FrozenDictionary spends more time at creation to make reads faster.
    public static long LookupAll(Dictionary<string, int> map, string[] keys)
    {
        long hits = 0;
        foreach (var key in keys)
        {
            if (map.TryGetValue(key, out var value)) hits += value;
        }
        return hits;
    }

    public static long LookupAll(FrozenDictionary<string, int> map, string[] keys)
    {
        long hits = 0;
        foreach (var key in keys)
        {
            if (map.TryGetValue(key, out var value)) hits += value;
        }
        return hits;
    }
    // </snippet:Perf.Lookup>
}
