namespace DotNet11Lab.Core.Labs.Linq;

/// <summary>A line on the bank statement.</summary>
public sealed record BankEntry(string Reference, decimal Amount, DateOnly Date, string Description);

/// <summary>A posting in the general ledger.</summary>
public sealed record LedgerEntry(string Reference, decimal Amount, DateOnly PostedOn, string Account);

public enum ReconciliationCategory
{
    Matched,
    AmountMismatch,
    /// <summary>Booked in the ledger but never seen on the bank statement.</summary>
    MissingInBank,
    /// <summary>On the bank statement but never booked in the ledger.</summary>
    MissingInLedger,
}

public sealed record ReconciliationLine(string Reference, BankEntry? Bank, LedgerEntry? Ledger, ReconciliationCategory Category)
{
    public decimal Difference => (Bank?.Amount ?? 0m) - (Ledger?.Amount ?? 0m);
}

public sealed record ReconciliationSummary(
    int BankEntries,
    int LedgerEntries,
    IReadOnlyDictionary<ReconciliationCategory, int> Counts,
    decimal BankTotal,
    decimal LedgerTotal,
    int DuplicateReferences)
{
    public decimal NetDifference => BankTotal - LedgerTotal;
    public int Count(ReconciliationCategory category) => Counts.GetValueOrDefault(category);
    public int Lines => Counts.Values.Sum();
    public double MatchRate => Lines == 0 ? 0 : (double)Count(ReconciliationCategory.Matched) / Lines;
}

/// <summary>
/// Three implementations of the same reconciliation. They must agree line for line (the tests check this),
/// including duplicate references, which every implementation pairs as a cross product, like SQL FULL OUTER JOIN.
/// </summary>
public static class Reconciler
{
    // <snippet:Linq.Classify>
    public static ReconciliationCategory Classify(BankEntry? bank, LedgerEntry? ledger) => (bank, ledger) switch
    {
        (null, not null) => ReconciliationCategory.MissingInBank,
        (not null, null) => ReconciliationCategory.MissingInLedger,
        (not null, not null) when bank.Amount == ledger.Amount => ReconciliationCategory.Matched,
        (not null, not null) => ReconciliationCategory.AmountMismatch,
        (null, null) => throw new InvalidOperationException("A join row must have at least one side."),
    };
    // </snippet:Linq.Classify>

    // <snippet:Linq.FullJoin>
    public static IEnumerable<ReconciliationLine> WithFullJoin(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        bank.FullJoin(ledger, b => b.Reference, l => l.Reference, StringComparer.Ordinal)
            .Select(pair => new ReconciliationLine(
                pair.Outer?.Reference ?? pair.Inner!.Reference,   // (Outer, Inner) tuple; either side may be null
                pair.Outer,
                pair.Inner,
                Classify(pair.Outer, pair.Inner)));
    // </snippet:Linq.FullJoin>

    // <snippet:Linq.LegacyFullJoin>
    // Before .NET 10 there was no outer join operator: left join via GroupJoin + SelectMany + DefaultIfEmpty,
    // then append the right-hand rows that have no partner (an anti-join), which enumerates the bank twice.
    public static IEnumerable<ReconciliationLine> WithGroupJoinEmulation(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger)
    {
        var bankList = bank as IReadOnlyCollection<BankEntry> ?? bank.ToList();
        var ledgerList = ledger as IReadOnlyCollection<LedgerEntry> ?? ledger.ToList();

        var left =
            from b in bankList
            join l in ledgerList on b.Reference equals l.Reference into matches
            from l in matches.DefaultIfEmpty()
            select new ReconciliationLine(b.Reference, b, l, Classify(b, l));

        var bankKeys = bankList.Select(b => b.Reference).ToHashSet(StringComparer.Ordinal);
        var rightOnly =
            from l in ledgerList
            where !bankKeys.Contains(l.Reference)
            select new ReconciliationLine(l.Reference, null, l, Classify(null, l));

        return left.Concat(rightOnly);
    }
    // </snippet:Linq.LegacyFullJoin>

    // <snippet:Linq.DictionaryJoin>
    // Hand-rolled: one dictionary of ledger postings by reference, one pass over each side.
    public static IEnumerable<ReconciliationLine> WithDictionary(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger)
    {
        var byReference = new Dictionary<string, List<LedgerEntry>>(StringComparer.Ordinal);
        foreach (var l in ledger)
        {
            if (!byReference.TryGetValue(l.Reference, out var list)) byReference[l.Reference] = list = [];
            list.Add(l);
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<ReconciliationLine>();
        foreach (var b in bank)
        {
            seen.Add(b.Reference);
            if (byReference.TryGetValue(b.Reference, out var matches))
                foreach (var l in matches) result.Add(new(b.Reference, b, l, Classify(b, l)));
            else
                result.Add(new(b.Reference, b, null, ReconciliationCategory.MissingInLedger));
        }
        foreach (var (reference, postings) in byReference)
        {
            if (seen.Contains(reference)) continue;
            foreach (var l in postings) result.Add(new(reference, null, l, ReconciliationCategory.MissingInBank));
        }
        return result;
    }
    // </snippet:Linq.DictionaryJoin>

    public static ReconciliationSummary Summarize(IReadOnlyCollection<BankEntry> bank, IReadOnlyCollection<LedgerEntry> ledger, IEnumerable<ReconciliationLine> lines)
    {
        var counts = Enum.GetValues<ReconciliationCategory>().ToDictionary(c => c, _ => 0);
        foreach (var line in lines) counts[line.Category]++;
        var duplicates = bank.CountBy(b => b.Reference).Count(kv => kv.Value > 1)
                         + ledger.CountBy(l => l.Reference).Count(kv => kv.Value > 1);
        return new(bank.Count, ledger.Count, counts, bank.Sum(b => b.Amount), ledger.Sum(l => l.Amount), duplicates);
    }

    /// <summary>Order-independent canonical form used to compare implementations.</summary>
    public static IReadOnlyList<ReconciliationLine> Canonical(IEnumerable<ReconciliationLine> lines) =>
        lines.OrderBy(l => l.Reference, StringComparer.Ordinal)
             .ThenBy(l => l.Bank?.Amount)
             .ThenBy(l => l.Ledger?.Amount)
             .ThenBy(l => l.Bank?.Description, StringComparer.Ordinal)
             .ThenBy(l => l.Ledger?.Account, StringComparer.Ordinal)
             .ToList();
}

/// <summary>The other new .NET 11 join shapes, on the same data.</summary>
public static class JoinShapes
{
    // <snippet:Linq.TupleJoin>
    // .NET 11: Join without a result selector returns (Outer, Inner) tuples — inner join only.
    public static IEnumerable<(BankEntry Bank, LedgerEntry Ledger)> MatchedPairs(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        bank.Join(ledger, b => b.Reference, l => l.Reference);

    // .NET 11: GroupJoin without a result selector returns IGrouping<TOuter, TInner> (Key = the bank entry).
    public static IEnumerable<IGrouping<BankEntry, LedgerEntry>> PostingsPerStatementLine(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        bank.GroupJoin(ledger, b => b.Reference, l => l.Reference);
    // </snippet:Linq.TupleJoin>

    // <snippet:Linq.LegacyTupleJoin>
    // .NET 10: a result selector is required even when all you want is the pair.
    public static IEnumerable<(BankEntry Bank, LedgerEntry Ledger)> LegacyMatchedPairs(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        bank.Join(ledger, b => b.Reference, l => l.Reference, (b, l) => (b, l));

    // .NET 10 LeftJoin (the baseline that FullJoin generalizes): statement lines with an optional posting.
    public static IEnumerable<(BankEntry Bank, LedgerEntry? Ledger)> LegacyLeftJoin(IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        bank.LeftJoin(ledger, b => b.Reference, l => l.Reference, (b, l) => (b, l));
    // </snippet:Linq.LegacyTupleJoin>
}
