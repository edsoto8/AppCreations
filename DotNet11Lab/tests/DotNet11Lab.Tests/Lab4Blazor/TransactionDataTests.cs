using DotNet11Lab.Core.Labs.Blazor;

namespace DotNet11Lab.Tests.Lab4Blazor;

public class TransactionDataTests
{
    private static readonly TransactionDataset Data = new();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void Dataset_has_100k_rows_with_sequential_ids()
    {
        Assert.Equal(100_000, Data.Count);
        Assert.Equal(Enumerable.Range(1, 100_000), Data.Items.Select(t => t.Id));
    }

    [Fact]
    public void Generation_is_deterministic()
    {
        var again = new TransactionDataset();
        Assert.Equal(Data.Items[12_345], again.Items[12_345]);
        Assert.Equal(Data.Items[^1], again.Items[^1]);
        Assert.Equal(Data.Items.Sum(t => t.Amount), again.Items.Sum(t => t.Amount));
    }

    [Fact]
    public void Dataset_has_variety_for_the_demos()
    {
        Assert.Equal(TransactionDataset.AllCategories.Count, Data.Items.Select(t => t.Category).Distinct().Count());
        Assert.All(Enum.GetValues<TransactionStatus>(), s => Assert.Contains(Data.Items, t => t.Status == s));
        var withNotes = Data.Items.Count(t => t.Note is not null);
        Assert.InRange(withNotes, 5_000, 20_000); // ~12% of rows are taller
        Assert.All(Data.Items.Where(t => t.Status == TransactionStatus.Refunded).Take(100), t => Assert.True(t.Amount < 0));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(TransactionDataset.MaxCount + 1)]
    public void Size_is_capped(int count) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => new TransactionDataset(count));

    [Fact]
    public void Empty_query_returns_everything_without_copying()
    {
        var result = TransactionSearch.Filter(Data, new TransactionQuery(), Ct);
        Assert.Same(Data.Items, result.Matches);
    }

    [Fact]
    public void Filters_combine()
    {
        var query = new TransactionQuery("pixel", "Software", TransactionStatus.Settled, 100m);
        var result = TransactionSearch.Filter(Data, query, Ct);

        var expected = Data.Items.Where(t => t.Merchant.Contains("pixel", StringComparison.OrdinalIgnoreCase) && t.Category == "Software"
            && t.Status == TransactionStatus.Settled && Math.Abs(t.Amount) >= 100m).Select(t => t.Id);
        Assert.Equal(expected, result.Matches.Select(t => t.Id));
        Assert.NotEmpty(result.Matches);
        Assert.Equal(100_000, result.Scanned);
    }

    [Fact]
    public void Text_search_matches_reference_and_note()
    {
        Assert.Single(TransactionSearch.Filter(Data, new TransactionQuery(Data.Items[41].Reference), Ct).Matches);
        Assert.Contains(TransactionSearch.Filter(Data, new TransactionQuery("reimbursement"), Ct).Matches, t => t.Note is not null);
    }

    [Fact]
    public void Filter_observes_cancellation()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        Assert.Throws<OperationCanceledException>(() => TransactionSearch.Filter(Data, new TransactionQuery("x"), cts.Token));
    }

    [Fact]
    public void Merchant_summary_totals_add_up()
    {
        var summary = TransactionSearch.SummarizeByMerchant(Data);
        Assert.Equal(32, summary.Count);
        Assert.Equal(Data.Count, summary.Sum(m => m.Transactions));
        Assert.Equal(Data.Items.Sum(t => t.Amount), summary.Sum(m => m.Total));
    }
}
