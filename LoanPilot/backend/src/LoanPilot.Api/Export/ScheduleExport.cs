using System.Globalization;
using System.Text;
using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Api.Export;

/// <summary>CSV and Excel exports of a loan's amortization schedule.</summary>
public static class ScheduleExport
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static readonly string[] MonthlyHeaders =
    [
        "Payment #", "Date", "Type", "Starting balance", "Scheduled payment", "Extra payment", "Total payment",
        "Interest", "Principal", "Ending balance", "Cumulative interest", "Unpaid interest", "Estimated",
    ];

    public static readonly string[] AnnualHeaders =
        ["Year", "Payments", "Total paid", "Principal", "Interest", "Extra", "Ending balance"];

    public static string FileBaseName(Loan loan, Scenario? scenario, bool annual)
    {
        var name = $"{loan.Name} {(scenario is null ? "schedule" : scenario.Name)}{(annual ? " annual" : "")}";
        var safe = new string(name.Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray());
        while (safe.Contains("--", StringComparison.Ordinal))
        {
            safe = safe.Replace("--", "-", StringComparison.Ordinal);
        }

        safe = safe.Trim('-');
        return safe.Length == 0 ? "loan-schedule" : safe[..Math.Min(safe.Length, 80)];
    }

    /// <summary>The schedule being exported: the scenario when one is given, otherwise the baseline, after any estimated history.</summary>
    public static IReadOnlyList<ScheduleRow> Rows(ScheduleResponse schedule) =>
        schedule.History.Concat((schedule.Scenario ?? schedule.Baseline).Rows).ToList();

    public static byte[] Csv(LoanAnalysis analysis, ScheduleResponse schedule, Scenario? scenario, bool annual)
    {
        var sb = new StringBuilder();
        if (annual)
        {
            sb.AppendLine(string.Join(",", AnnualHeaders));
            foreach (var row in (scenario is null ? schedule.BaselineAnnual : schedule.ScenarioAnnual) ?? [])
            {
                sb.AppendLine(string.Join(",", row.Year.ToString(Invariant), row.Payments.ToString(Invariant), M(row.TotalPaid),
                    M(row.Principal), M(row.Interest), M(row.Extra), M(row.EndingBalance)));
            }
        }
        else
        {
            sb.AppendLine(string.Join(",", MonthlyHeaders));
            foreach (var row in Rows(schedule))
            {
                sb.AppendLine(string.Join(",",
                    row.Number?.ToString(Invariant) ?? "",
                    row.Date.ToString("yyyy-MM-dd", Invariant),
                    row.Kind == ScheduleRowKind.LumpSum ? "Lump sum" : "Payment",
                    M(row.StartingBalance), M(row.ScheduledPayment), M(row.ExtraPayment), M(row.TotalPayment),
                    M(row.Interest), M(row.Principal), M(row.EndingBalance), M(row.CumulativeInterest), M(row.UnpaidInterest),
                    row.IsEstimated ? "yes" : "no"));
            }
        }

        // UTF-8 with BOM so Excel detects the encoding of non-ASCII loan names.
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
    }

    public static byte[] Xlsx(LoanAnalysis analysis, ScheduleResponse schedule, Scenario? scenario)
    {
        var used = new HashSet<string>();
        var sheets = new List<XlsxSheet>
        {
            Summary(analysis, schedule, scenario, XlsxWriter.SafeSheetName("Summary", used)),
            Monthly(XlsxWriter.SafeSheetName("Baseline schedule", used), schedule.History.Concat(schedule.Baseline.Rows)),
            Annual(XlsxWriter.SafeSheetName("Baseline by year", used), schedule.BaselineAnnual),
        };

        if (scenario is not null && schedule.Scenario is { } projection)
        {
            sheets.Add(Monthly(XlsxWriter.SafeSheetName(scenario.Name, used), schedule.History.Concat(projection.Rows)));
            sheets.Add(Annual(XlsxWriter.SafeSheetName(scenario.Name + " by year", used), schedule.ScenarioAnnual ?? []));
        }

        return XlsxWriter.Write(sheets);
    }

    /// <summary>Formats money for CSV with invariant culture (no grouping, dot decimal).</summary>
    private static string M(decimal value) => value.ToString("0.00", Invariant);

    private static XlsxSheet Monthly(string name, IEnumerable<ScheduleRow> rows) => new(
        name,
        MonthlyHeaders,
        rows.Select(r => (IReadOnlyList<XlsxCell>)
        [
            r.Number is { } n ? new XlsxCell.Number(n) : XlsxCell.Blank,
            new XlsxCell.Date(r.Date),
            new XlsxCell.Text(r.Kind == ScheduleRowKind.LumpSum ? "Lump sum" : "Payment"),
            new XlsxCell.Money(r.StartingBalance), new XlsxCell.Money(r.ScheduledPayment), new XlsxCell.Money(r.ExtraPayment),
            new XlsxCell.Money(r.TotalPayment), new XlsxCell.Money(r.Interest), new XlsxCell.Money(r.Principal),
            new XlsxCell.Money(r.EndingBalance), new XlsxCell.Money(r.CumulativeInterest), new XlsxCell.Money(r.UnpaidInterest),
            new XlsxCell.Text(r.IsEstimated ? "yes" : "no"),
        ]).ToList(),
        [10, 12, 10, 16, 16, 14, 14, 12, 12, 16, 18, 15, 10]);

    private static XlsxSheet Annual(string name, IEnumerable<AnnualSummaryRow> rows) => new(
        name,
        AnnualHeaders,
        rows.Select(r => (IReadOnlyList<XlsxCell>)
        [
            new XlsxCell.Number(r.Year), new XlsxCell.Number(r.Payments), new XlsxCell.Money(r.TotalPaid),
            new XlsxCell.Money(r.Principal), new XlsxCell.Money(r.Interest), new XlsxCell.Money(r.Extra), new XlsxCell.Money(r.EndingBalance),
        ]).ToList(),
        [8, 10, 14, 14, 14, 14, 16]);

    private static XlsxSheet Summary(LoanAnalysis analysis, ScheduleResponse schedule, Scenario? scenario, string name)
    {
        var loan = analysis.Loan;
        var s = analysis.Status;
        var rows = new List<IReadOnlyList<XlsxCell>>();
        void Line(string label, XlsxCell value) => rows.Add([new XlsxCell.Text(label, Bold: true), value]);

        Line("Loan", new XlsxCell.Text(loan.Name));
        if (loan.Lender is { } lender)
        {
            Line("Lender", new XlsxCell.Text(lender));
        }

        Line("Original amount", new XlsxCell.Money(loan.OriginalAmount));
        Line("APR", new XlsxCell.Percent(loan.AprPercent));
        Line("Term (months)", new XlsxCell.Number(loan.TermMonths));
        Line("Interest accrual", new XlsxCell.Text(loan.AccrualMethod == AccrualMethod.DailySimple
            ? $"Daily simple interest ({(loan.DayCountBasis == DayCountBasis.Actual365 ? "Actual/365" : "Actual/Actual")})"
            : "Monthly (APR ÷ periods per year)"));
        Line("Scheduled payment", new XlsxCell.Money(s.ScheduledPayment));
        Line(s.BalanceIsEstimated ? "Balance (estimated)" : "Current balance", new XlsxCell.Money(s.CurrentBalance));
        Line("Balance as of", new XlsxCell.Date(s.BalanceAsOf));
        Line("Projected payoff (baseline)", s.PayoffDate is { } payoff ? new XlsxCell.Date(payoff) : new XlsxCell.Text("Not repaid"));
        Line("Remaining interest (baseline)", new XlsxCell.Money(s.RemainingInterest));
        if (scenario is not null && schedule.Scenario is { } projection)
        {
            var c = Simulator.Compare(schedule.Baseline, projection);
            Line("Scenario", new XlsxCell.Text(scenario.Name));
            Line("Scenario payoff", c.NewPayoffDate is { } d ? new XlsxCell.Date(d) : new XlsxCell.Text("Not repaid"));
            Line("Scenario remaining interest", new XlsxCell.Money(c.NewInterest));
            Line("Interest saved", new XlsxCell.Money(c.InterestSaved));
            Line("Months saved", new XlsxCell.Number(c.MonthsSaved));
        }

        Line("Generated for", new XlsxCell.Date(analysis.Today));
        rows.Add([]);
        rows.Add([new XlsxCell.Text("Estimates only. Lender rules, fees, payment posting dates and contract terms can change actual payoff amounts; ask your lender for an official payoff quote.")]);
        return new XlsxSheet(name, [], rows, [32, 40]);
    }
}
