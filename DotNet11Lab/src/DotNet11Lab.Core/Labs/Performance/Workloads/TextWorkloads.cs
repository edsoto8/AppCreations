using System.Globalization;
using System.Text;

namespace DotNet11Lab.Core.Labs.Performance.Workloads;

/// <summary>
/// Parsing and string building, written two ways: the allocation-heavy version people usually write first and an
/// allocation-efficient version. This file is compiled into DotNet11Lab.Core (live page, .NET 11) and linked into
/// DotNet11Lab.Benchmarks (BenchmarkDotNet, .NET 10 and .NET 11), so both measure exactly the same code.
/// </summary>
public static class TextWorkloads
{
    // <snippet:Perf.ParseSplit>
    // Allocates a string[] plus one string per field before parsing.
    public static long SumWithSplit(string csv)
    {
        long sum = 0;
        foreach (var field in csv.Split(','))
        {
            sum += int.Parse(field, CultureInfo.InvariantCulture);
        }
        return sum;
    }
    // </snippet:Perf.ParseSplit>

    // <snippet:Perf.ParseSpan>
    // Enumerates ranges over the original characters: no array, no substrings.
    public static long SumWithSpans(string csv)
    {
        long sum = 0;
        ReadOnlySpan<char> span = csv;
        foreach (Range range in span.Split(','))
        {
            sum += int.Parse(span[range], CultureInfo.InvariantCulture);
        }
        return sum;
    }
    // </snippet:Perf.ParseSpan>

    // <snippet:Perf.BuildConcat>
    // Each += copies everything built so far: O(n²) bytes copied and one new string per line.
    public static int BuildWithConcat(int lines)
    {
        var report = "";
        for (var i = 0; i < lines; i++)
        {
            report += "line " + i + ": " + (i * 7 % 100) + "\n";
        }
        return report.Length;
    }
    // </snippet:Perf.BuildConcat>

    // <snippet:Perf.BuildStringBuilder>
    // One growable buffer; Append(int) formats straight into it.
    public static int BuildWithStringBuilder(int lines)
    {
        var report = new StringBuilder(capacity: lines * 16);
        for (var i = 0; i < lines; i++)
        {
            report.Append("line ").Append(i).Append(": ").Append(i * 7 % 100).Append('\n');
        }
        return report.ToString().Length;
    }
    // </snippet:Perf.BuildStringBuilder>
}
