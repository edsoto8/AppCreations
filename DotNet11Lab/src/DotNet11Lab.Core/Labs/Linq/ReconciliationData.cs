using System.Globalization;
using DotNet11Lab.Core.Diagnostics;

namespace DotNet11Lab.Core.Labs.Linq;

/// <summary>Settings for the deterministic generator. Rates are percentages of the base transaction count.</summary>
public sealed record ReconciliationScenario(
    int Seed = 2026,
    int Transactions = 5_000,
    double MissingInBankPercent = 2,
    double MissingInLedgerPercent = 1.5,
    double AmountMismatchPercent = 1,
    double DuplicatePercent = 0.2)
{
    public const int MaxTransactions = 200_000;

    public ReconciliationScenario Normalized() => this with
    {
        Transactions = Math.Clamp(Transactions, 0, MaxTransactions),
        MissingInBankPercent = Math.Clamp(MissingInBankPercent, 0, 50),
        MissingInLedgerPercent = Math.Clamp(MissingInLedgerPercent, 0, 50),
        AmountMismatchPercent = Math.Clamp(AmountMismatchPercent, 0, 50),
        DuplicatePercent = Math.Clamp(DuplicatePercent, 0, 10),
    };
}

public sealed record ReconciliationDataset(IReadOnlyList<BankEntry> Bank, IReadOnlyList<LedgerEntry> Ledger);

public static class ReconciliationDataGenerator
{
    private static readonly string[] Counterparties =
        ["Contoso Ltd", "Fabrikam Inc", "Northwind Traders", "Adventure Works", "Tailspin Toys", "Wide World Importers", "Litware", "Proseware"];
    private static readonly string[] Accounts = ["4000 Sales", "4010 Services", "6100 Rent", "6200 Utilities", "6400 Software", "2100 Payables"];

    /// <summary>
    /// Generates matching bank and ledger data, then injects discrepancies at the requested rates.
    /// The same scenario always yields the same data.
    /// </summary>
    public static ReconciliationDataset Generate(ReconciliationScenario scenario, CancellationToken cancellationToken = default)
    {
        var s = scenario.Normalized();
        var random = new Random(s.Seed);
        var start = new DateOnly(2026, 10, 1);
        var bank = new List<BankEntry>(s.Transactions);
        var ledger = new List<LedgerEntry>(s.Transactions);

        for (var i = 0; i < s.Transactions; i++)
        {
            if ((i & 0xFFF) == 0) cancellationToken.ThrowIfCancellationRequested();
            var reference = $"TRX-{s.Seed % 1000:000}-{i + 1:000000}";
            var amount = Math.Round((decimal)(random.NextDouble() * 4_990 + 10), 2) * (random.Next(4) == 0 ? -1 : 1);
            var date = start.AddDays(random.Next(30));
            var roll = random.NextDouble() * 100;

            if (roll < s.MissingInBankPercent)
            {
                ledger.Add(new(reference, amount, date, Accounts[random.Next(Accounts.Length)]));       // not yet cleared
                continue;
            }
            roll -= s.MissingInBankPercent;
            if (roll < s.MissingInLedgerPercent)
            {
                bank.Add(new(reference, amount, date, BankText(random, amount)));                     // e.g. bank fee
                continue;
            }
            roll -= s.MissingInLedgerPercent;

            var bankAmount = roll < s.AmountMismatchPercent
                ? amount + Math.Round((decimal)(random.NextDouble() * 50 + 0.01), 2) * (random.Next(2) == 0 ? -1 : 1)
                : amount;
            bank.Add(new(reference, bankAmount, date.AddDays(random.Next(3)), BankText(random, bankAmount)));
            ledger.Add(new(reference, amount, date, Accounts[random.Next(Accounts.Length)]));

            if (random.NextDouble() * 100 < s.DuplicatePercent)
                ledger.Add(new(reference, amount, date, Accounts[random.Next(Accounts.Length)]));       // double-posted
        }

        Shuffle(bank, random);
        Shuffle(ledger, random);
        return new(bank, ledger);
    }

    private static string BankText(Random random, decimal amount) =>
        (amount < 0 ? "DEBIT " : "CREDIT ") + Counterparties[random.Next(Counterparties.Length)];

    private static void Shuffle<T>(List<T> list, Random random)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    public static string ToBankCsv(IEnumerable<BankEntry> entries) =>
        "reference,amount,date,description\n" + string.Join('\n', entries.Select(e =>
            string.Create(CultureInfo.InvariantCulture, $"{e.Reference},{e.Amount},{e.Date:yyyy-MM-dd},{e.Description}")));

    public static string ToLedgerCsv(IEnumerable<LedgerEntry> entries) =>
        "reference,amount,date,account\n" + string.Join('\n', entries.Select(e =>
            string.Create(CultureInfo.InvariantCulture, $"{e.Reference},{e.Amount},{e.PostedOn:yyyy-MM-dd},{e.Account}")));
}

public sealed record CsvParseResult<T>(IReadOnlyList<T> Rows, IReadOnlyList<string> Errors);

/// <summary>Minimal parser for the small hand-editable CSVs (no quoted fields).</summary>
public static class TransactionCsv
{
    public const int MaxRows = 2_000;
    public const int MaxChars = 200_000;

    public static CsvParseResult<BankEntry> ParseBank(string csv) =>
        Parse(csv, (reference, amount, date, text) => new BankEntry(reference, amount, date, text));

    public static CsvParseResult<LedgerEntry> ParseLedger(string csv) =>
        Parse(csv, (reference, amount, date, text) => new LedgerEntry(reference, amount, date, text));

    private static CsvParseResult<T> Parse<T>(string csv, Func<string, decimal, DateOnly, string, T> create)
    {
        var rows = new List<T>();
        var errors = new List<string>();
        if (csv.Length > MaxChars)
            return new(rows, [$"Input is {csv.Length:N0} characters; the limit is {MaxChars:N0}."]);

        var lines = csv.ReplaceLineEndings("\n").Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (i == 0 && line.StartsWith("reference", StringComparison.OrdinalIgnoreCase)) continue;   // header
            if (rows.Count >= MaxRows) { errors.Add($"Only the first {MaxRows:N0} rows were read."); break; }

            var parts = line.Split(',', 4, StringSplitOptions.TrimEntries);
            if (parts.Length < 3) { errors.Add($"Line {i + 1}: expected reference,amount,date[,text]."); continue; }
            if (parts[0].Length == 0) { errors.Add($"Line {i + 1}: reference is empty."); continue; }
            if (!decimal.TryParse(parts[1], NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            { errors.Add($"Line {i + 1}: '{parts[1]}' is not an amount."); continue; }
            if (!DateOnly.TryParseExact(parts[2], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            { errors.Add($"Line {i + 1}: '{parts[2]}' is not a yyyy-MM-dd date."); continue; }
            rows.Add(create(parts[0], amount, date, parts.Length > 3 ? parts[3] : ""));
        }
        return new(rows, errors);
    }

    public static string SampleBank { get; } = """
        reference,amount,date,description
        INV-1001,1250.00,2026-10-02,CREDIT Contoso Ltd
        INV-1002,-89.90,2026-10-03,DEBIT Litware
        INV-1003,430.10,2026-10-03,CREDIT Fabrikam Inc
        INV-1004,999.99,2026-10-05,CREDIT Northwind Traders
        FEE-0001,-12.50,2026-10-06,DEBIT Monthly account fee
        INV-1006,310.00,2026-10-07,CREDIT Tailspin Toys
        """;

    public static string SampleLedger { get; } = """
        reference,amount,date,account
        INV-1001,1250.00,2026-10-01,4000 Sales
        INV-1002,-89.90,2026-10-02,6400 Software
        INV-1003,403.10,2026-10-03,4000 Sales
        INV-1005,75.00,2026-10-04,4010 Services
        INV-1006,310.00,2026-10-06,4000 Sales
        INV-1006,310.00,2026-10-06,4000 Sales
        """;
}

public sealed record JoinBenchmarkResult(int BankEntries, int LedgerEntries, IReadOnlyList<Measurement> Measurements, bool AllAgree);

public static class ReconciliationBenchmark
{
    public const int MaxTransactions = 100_000;
    public const int MaxIterations = 50;

    /// <summary>Times the three implementations on the same generated data. Each run materializes all lines.</summary>
    public static JoinBenchmarkResult Run(int transactions, int iterations, CancellationToken cancellationToken)
    {
        transactions = Math.Clamp(transactions, 100, MaxTransactions);
        iterations = Math.Clamp(iterations, 1, MaxIterations);
        var data = ReconciliationDataGenerator.Generate(new ReconciliationScenario(Seed: 7, Transactions: transactions), cancellationToken);

        var full = Reconciler.Canonical(Reconciler.WithFullJoin(data.Bank, data.Ledger));
        var agree = full.SequenceEqual(Reconciler.Canonical(Reconciler.WithGroupJoinEmulation(data.Bank, data.Ledger)))
                    && full.SequenceEqual(Reconciler.Canonical(Reconciler.WithDictionary(data.Bank, data.Ledger)));

        Measurement[] measurements =
        [
            Measure.Run("FullJoin (.NET 11)", iterations, () => Drain(Reconciler.WithFullJoin(data.Bank, data.Ledger)), cancellationToken),
            Measure.Run("GroupJoin + anti-join", iterations, () => Drain(Reconciler.WithGroupJoinEmulation(data.Bank, data.Ledger)), cancellationToken),
            Measure.Run("Dictionary, hand-rolled", iterations, () => Drain(Reconciler.WithDictionary(data.Bank, data.Ledger)), cancellationToken),
        ];
        return new(data.Bank.Count, data.Ledger.Count, measurements, agree);
    }

    private static int Drain(IEnumerable<ReconciliationLine> lines)
    {
        var n = 0;
        foreach (var _ in lines) n++;
        return n;
    }
}

