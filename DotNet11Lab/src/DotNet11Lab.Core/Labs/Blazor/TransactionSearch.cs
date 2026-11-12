using System.Diagnostics;

namespace DotNet11Lab.Core.Labs.Blazor;

/// <summary>Filter for the transaction explorer. Every part is optional.</summary>
public sealed record TransactionQuery(string? Text = null, string? Category = null, TransactionStatus? Status = null, decimal? MinAmount = null)
{
    public const int MaxTextLength = 64;

    public bool IsEmpty => string.IsNullOrWhiteSpace(Text) && Category is null && Status is null && MinAmount is null;
}

/// <summary>The rows that matched, plus how long the scan took (measured, not estimated).</summary>
public sealed record TransactionSearchResult(IReadOnlyList<Transaction> Matches, int Scanned, TimeSpan Elapsed);

public sealed record MerchantSummary(string Merchant, string Category, int Transactions, decimal Total, decimal Average);

public static class TransactionSearch
{
    // <snippet:Blazor.FilterScan>
    /// <summary>
    /// Linear scan over the in-memory ledger. Text matches merchant, reference or note (case-insensitive).
    /// Checks the token every 8,192 rows so a newer keystroke cancels an older scan quickly.
    /// </summary>
    public static TransactionSearchResult Filter(TransactionDataset data, TransactionQuery query, CancellationToken cancellationToken = default)
    {
        var stopwatch = Stopwatch.StartNew();
        if (query.IsEmpty) return new TransactionSearchResult(data.Items, data.Count, stopwatch.Elapsed);

        var text = query.Text?.Trim();
        if (text is { Length: > TransactionQuery.MaxTextLength }) text = text[..TransactionQuery.MaxTextLength];
        var matches = new List<Transaction>();
        var items = data.Items;
        for (var i = 0; i < items.Count; i++)
        {
            if ((i & 8191) == 0) cancellationToken.ThrowIfCancellationRequested();
            var t = items[i];
            if (query.Category is not null && t.Category != query.Category) continue;
            if (query.Status is { } status && t.Status != status) continue;
            if (query.MinAmount is { } min && Math.Abs(t.Amount) < min) continue;
            if (!string.IsNullOrEmpty(text)
                && !t.Merchant.Contains(text, StringComparison.OrdinalIgnoreCase)
                && !t.Reference.Contains(text, StringComparison.OrdinalIgnoreCase)
                && !(t.Note?.Contains(text, StringComparison.OrdinalIgnoreCase) ?? false)) continue;
            matches.Add(t);
        }
        return new TransactionSearchResult(matches, items.Count, stopwatch.Elapsed);
    }
    // </snippet:Blazor.FilterScan>

    /// <summary>Per-merchant totals for the second QuickGrid (a few dozen rows).</summary>
    public static IReadOnlyList<MerchantSummary> SummarizeByMerchant(TransactionDataset data) =>
        data.Items.GroupBy(t => (t.Merchant, t.Category))
            .Select(g => new MerchantSummary(g.Key.Merchant, g.Key.Category, g.Count(), g.Sum(t => t.Amount), Math.Round(g.Average(t => t.Amount), 2)))
            .OrderBy(m => m.Merchant, StringComparer.Ordinal)
            .ToArray();
}
