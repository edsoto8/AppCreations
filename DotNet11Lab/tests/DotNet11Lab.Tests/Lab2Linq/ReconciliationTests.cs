using DotNet11Lab.Core.Labs.Linq;
using static DotNet11Lab.Core.Labs.Linq.ReconciliationCategory;

namespace DotNet11Lab.Tests.Lab2Linq;

public class ReconciliationTests
{
    private static readonly DateOnly D = new(2026, 10, 1);

    public static TheoryData<string> Implementations() => ["FullJoin", "GroupJoin", "Dictionary"];

    private static IReadOnlyList<ReconciliationLine> Run(string implementation, IEnumerable<BankEntry> bank, IEnumerable<LedgerEntry> ledger) =>
        Reconciler.Canonical(implementation switch
        {
            "FullJoin" => Reconciler.WithFullJoin(bank, ledger),
            "GroupJoin" => Reconciler.WithGroupJoinEmulation(bank, ledger),
            "Dictionary" => Reconciler.WithDictionary(bank, ledger),
            _ => throw new ArgumentOutOfRangeException(nameof(implementation)),
        });

    [Theory]
    [MemberData(nameof(Implementations))]
    public void Classifies_every_category(string implementation)
    {
        BankEntry[] bank = [new("A", 10m, D, ""), new("B", 20m, D, ""), new("C", 5m, D, "")];
        LedgerEntry[] ledger = [new("A", 10m, D, ""), new("B", 21m, D, ""), new("Z", 7m, D, "")];

        var lines = Run(implementation, bank, ledger);

        Assert.Equal([("A", Matched), ("B", AmountMismatch), ("C", MissingInLedger), ("Z", MissingInBank)],
            lines.Select(l => (l.Reference, l.Category)));
        Assert.Equal(-1m, lines.Single(l => l.Reference == "B").Difference);
    }

    [Theory]
    [MemberData(nameof(Implementations))]
    public void Duplicate_keys_pair_as_a_cross_product(string implementation)
    {
        BankEntry[] bank = [new("A", 10m, D, "b1"), new("A", 10m, D, "b2")];
        LedgerEntry[] ledger = [new("A", 10m, D, "l1"), new("A", 12m, D, "l2"), new("A", 10m, D, "l3")];

        var lines = Run(implementation, bank, ledger);

        Assert.Equal(6, lines.Count);
        Assert.Equal(4, lines.Count(l => l.Category == Matched));
        Assert.Equal(2, lines.Count(l => l.Category == AmountMismatch));
    }

    [Theory]
    [MemberData(nameof(Implementations))]
    public void Empty_sides_produce_only_missing_lines(string implementation)
    {
        LedgerEntry[] ledger = [new("X", 1m, D, ""), new("X", 2m, D, "")];

        Assert.Empty(Run(implementation, [], []));
        Assert.All(Run(implementation, [], ledger), l => Assert.Equal(MissingInBank, l.Category));
        Assert.All(Run(implementation, [new BankEntry("Y", 1m, D, "")], []), l => Assert.Equal(MissingInLedger, l.Category));
    }

    [Fact]
    public void References_are_compared_ordinally_case_sensitive()
    {
        var lines = Run("FullJoin", [new BankEntry("inv-1", 1m, D, "")], [new LedgerEntry("INV-1", 1m, D, "")]);
        Assert.Equal(2, lines.Count);
        Assert.Equal(lines, Run("GroupJoin", [new BankEntry("inv-1", 1m, D, "")], [new LedgerEntry("INV-1", 1m, D, "")]));
    }

    [Theory]
    [InlineData(1, 1_000)]
    [InlineData(99, 20_000)]
    public void All_three_implementations_agree_on_generated_data(int seed, int size)
    {
        var data = ReconciliationDataGenerator.Generate(
            new ReconciliationScenario(seed, size, 3, 2, 1.5, 1), TestContext.Current.CancellationToken);

        var full = Run("FullJoin", data.Bank, data.Ledger);

        Assert.Equal(full, Run("GroupJoin", data.Bank, data.Ledger));
        Assert.Equal(full, Run("Dictionary", data.Bank, data.Ledger));
        Assert.All(Enum.GetValues<ReconciliationCategory>(), c => Assert.Contains(full, l => l.Category == c));
    }

    [Fact]
    public void Generator_is_deterministic_and_respects_zero_rates()
    {
        var scenario = new ReconciliationScenario(5, 2_000, 0, 0, 0, 0);
        var a = ReconciliationDataGenerator.Generate(scenario, TestContext.Current.CancellationToken);
        var b = ReconciliationDataGenerator.Generate(scenario, TestContext.Current.CancellationToken);

        Assert.Equal(a.Bank, b.Bank);
        Assert.Equal(a.Ledger, b.Ledger);
        var summary = Reconciler.Summarize([.. a.Bank], [.. a.Ledger], Reconciler.WithFullJoin(a.Bank, a.Ledger));
        Assert.Equal(2_000, summary.Count(Matched));
        Assert.Equal(1.0, summary.MatchRate);
        Assert.Equal(0m, summary.NetDifference);
    }

    [Fact]
    public void Generator_caps_size()
    {
        var scenario = new ReconciliationScenario(Transactions: 10_000_000).Normalized();
        Assert.Equal(ReconciliationScenario.MaxTransactions, scenario.Transactions);
    }

    [Fact]
    public void Summary_counts_duplicates_and_totals()
    {
        var bank = TransactionCsv.ParseBank(TransactionCsv.SampleBank);
        var ledger = TransactionCsv.ParseLedger(TransactionCsv.SampleLedger);
        Assert.Empty(bank.Errors);
        Assert.Empty(ledger.Errors);

        var lines = Reconciler.WithFullJoin(bank.Rows, ledger.Rows).ToList();
        var summary = Reconciler.Summarize([.. bank.Rows], [.. ledger.Rows], lines);

        Assert.Equal(1, summary.DuplicateReferences);                 // INV-1006 booked twice
        Assert.Equal(4, summary.Count(Matched));                      // 1001, 1002, 1006 ×2
        Assert.Equal(1, summary.Count(AmountMismatch));               // 1003: 430.10 vs 403.10
        Assert.Equal(1, summary.Count(MissingInBank));                // 1005
        Assert.Equal(2, summary.Count(MissingInLedger));              // 1004, FEE-0001
    }

    [Fact]
    public void Csv_parser_reports_bad_rows_with_line_numbers()
    {
        var result = TransactionCsv.ParseBank("reference,amount,date,description\nA,abc,2026-01-01,x\n,1,2026-01-01\nB,1.5,01/02/2026\nC,2.25,2026-01-03,ok");

        Assert.Single(result.Rows);
        Assert.Equal(3, result.Errors.Count);
        Assert.Contains("Line 2", result.Errors[0], StringComparison.Ordinal);
    }

    [Fact]
    public void Tuple_join_shapes_match_their_legacy_equivalents()
    {
        var bank = TransactionCsv.ParseBank(TransactionCsv.SampleBank).Rows;
        var ledger = TransactionCsv.ParseLedger(TransactionCsv.SampleLedger).Rows;

        Assert.Equal(JoinShapes.LegacyMatchedPairs(bank, ledger), JoinShapes.MatchedPairs(bank, ledger));
        var groups = JoinShapes.PostingsPerStatementLine(bank, ledger).ToList();
        Assert.Equal(bank.Count, groups.Count);
        Assert.Equal(2, groups.Single(g => g.Key.Reference == "INV-1006").Count());
        Assert.Equal(JoinShapes.LegacyLeftJoin(bank, ledger).Count(), groups.Sum(g => Math.Max(1, g.Count())));
    }

    [Fact]
    public void Benchmark_reports_three_measurements_that_agree()
    {
        var result = ReconciliationBenchmark.Run(2_000, 2, TestContext.Current.CancellationToken);

        Assert.True(result.AllAgree);
        Assert.Equal(3, result.Measurements.Count);
        Assert.All(result.Measurements, m => Assert.True(m.Elapsed > TimeSpan.Zero));
    }
}
