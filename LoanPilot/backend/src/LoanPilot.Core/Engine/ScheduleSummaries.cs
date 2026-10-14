namespace LoanPilot.Core.Engine;

public sealed record AnnualSummaryRow(int Year, int Payments, decimal TotalPaid, decimal Principal, decimal Interest, decimal Extra, decimal EndingBalance);

public static class ScheduleSummaries
{
    /// <summary>Groups schedule rows by calendar year of their date. Lump-sum rows count toward Extra, not Payments.</summary>
    public static IReadOnlyList<AnnualSummaryRow> Annual(IEnumerable<ScheduleRow> rows) =>
        rows.GroupBy(r => r.Date.Year)
            .OrderBy(g => g.Key)
            .Select(g => new AnnualSummaryRow(
                g.Key,
                g.Count(r => r.Kind == ScheduleRowKind.Payment),
                g.Sum(r => r.TotalPayment),
                g.Sum(r => r.Principal),
                g.Sum(r => r.Interest),
                g.Sum(r => r.ExtraPayment),
                g.Last().EndingBalance))
            .ToList();
}
