using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public enum ComparisonKind
{
    Baseline = 0,
    Preset = 1,
    Saved = 2,
}

public sealed record BalancePoint(DateOnly Date, decimal Balance);

public sealed record ComparisonRow(
    string Key,
    string Name,
    ComparisonKind Kind,
    long? ScenarioId,
    bool PaysOff,
    DateOnly? PayoffDate,
    int MonthsToPayoff,
    int PaymentCount,
    decimal TotalInterest,
    decimal InterestSaved,
    int MonthsSaved,
    decimal PercentInterestReduction,
    decimal RecurringPayment,
    decimal LumpSumTotal,
    decimal TotalPaid,
    IReadOnlyList<BalancePoint> BalanceSeries);

public sealed record BestPicks(string? FastestPayoff, string? LowestInterest, string? LowestRecurringPayment, string? BestWithinBudget);

public sealed record ComparisonResult(decimal? Budget, IReadOnlyList<ComparisonRow> Rows, BestPicks Best, IReadOnlyList<string> Notes);

/// <summary>Compares the baseline, a few standard presets and the user's saved scenarios.</summary>
public static class ScenarioComparer
{
    public static readonly decimal[] PresetExtras = [50m, 100m];

    public static ComparisonResult Compare(LoanAnalysis analysis, IReadOnlyList<Scenario> saved, decimal? budget)
    {
        var format = analysis.Format;
        var rows = new List<ComparisonRow>
        {
            Row(analysis, "baseline", "Standard payments", ComparisonKind.Baseline, null, null),
        };
        var notes = new List<string>();

        if (!analysis.Status.IsPaidOff)
        {
            var per = analysis.Loan.PaymentFrequency == PaymentFrequency.Monthly ? "month" : "payment";
            foreach (var extra in PresetExtras)
            {
                rows.Add(Row(analysis, $"preset:extra-{extra:0}", $"Extra {format.WholeMoney(extra)}/{per}", ComparisonKind.Preset, null,
                    new Scenario { Name = "preset", RecurringExtras = [new RecurringExtra(extra)] }));
            }

            var lump = SuggestedLumpSum(analysis.Status.CurrentBalance);
            if (lump > 0m)
            {
                rows.Add(Row(analysis, $"preset:lump-{lump:0}", $"{format.WholeMoney(lump)} lump sum today", ComparisonKind.Preset, null,
                    new Scenario { Name = "preset", LumpSums = [new LumpSum(lump, analysis.EffectiveToday)] }));
            }
        }

        foreach (var scenario in saved)
        {
            if (ScenarioValidator.Validate(scenario, analysis, requireName: false, format).Count > 0)
            {
                notes.Add($"\"{scenario.Name}\" is not valid for the loan's current details (for example a lump sum dated before the balance date) and was skipped. Edit it in the simulator.");
                continue;
            }

            rows.Add(Row(analysis, $"scenario:{scenario.Id}", scenario.Name, ComparisonKind.Saved, scenario.Id, scenario));
        }

        var payingOff = rows.Where(r => r.PaysOff).ToList();
        var improving = payingOff.Where(r => r.Kind != ComparisonKind.Baseline && r.InterestSaved > 0m).ToList();
        string? fastest = payingOff.OrderBy(r => r.PayoffDate).ThenBy(r => r.TotalInterest).FirstOrDefault()?.Key;
        string? lowestInterest = payingOff.OrderBy(r => r.TotalInterest).ThenBy(r => r.PayoffDate).FirstOrDefault()?.Key;
        string? lowestRecurring = improving.OrderBy(r => r.RecurringPayment).ThenBy(r => r.TotalInterest).FirstOrDefault()?.Key;
        string? withinBudget = null;
        if (budget is { } limit)
        {
            withinBudget = payingOff.Where(r => r.RecurringPayment <= limit)
                .OrderBy(r => r.TotalInterest).ThenBy(r => r.PayoffDate).FirstOrDefault()?.Key;
            notes.Add($"\"Best within budget\" compares each strategy's highest regular payment with {format.Money(limit)}; lump sums are not counted against the monthly budget.");
            if (withinBudget is null)
            {
                notes.Add("No strategy fits within the budget.");
            }
        }

        notes.Add("\"Lowest recurring payment\" is the strategy that saves interest with the smallest regular payment; lump-sum-only strategies count as the scheduled payment.");
        return new ComparisonResult(budget, rows, new BestPicks(fastest, lowestInterest, lowestRecurring, withinBudget), notes);
    }

    /// <summary>A round lump sum of about 10 % of the balance ($500 steps under $10,000, $1,000 above), always below the balance; 0 when the balance is under $100.01.</summary>
    public static decimal SuggestedLumpSum(decimal balance)
    {
        if (balance <= 0m)
        {
            return 0m;
        }

        var tenth = balance * 0.10m;
        var step = tenth < 10_000m ? 500m : 1_000m;
        var amount = Math.Max(step, Math.Round(tenth / step, MidpointRounding.AwayFromZero) * step);
        return amount < balance ? amount : Math.Floor((balance - 0.01m) / 100m) * 100m;
    }

    /// <summary>The highest regular outlay (scheduled + recurring extra) of any payment except the final one.</summary>
    public static decimal RecurringPayment(Projection projection, decimal scheduledPayment)
    {
        var payments = projection.Rows.Where(r => r.Kind == ScheduleRowKind.Payment).ToList();
        if (payments.Count <= 1)
        {
            return payments.Count == 1 ? Math.Min(scheduledPayment, payments[0].ScheduledPayment + payments[0].RecurringExtra) : scheduledPayment;
        }

        return payments.Take(payments.Count - 1).Max(r => r.ScheduledPayment + r.RecurringExtra);
    }

    public static IReadOnlyList<BalancePoint> BalanceSeries(LoanAnalysis analysis, Projection projection)
    {
        var points = new List<BalancePoint>(projection.Rows.Count + 1)
        {
            new(analysis.Status.ProjectionStartDate, analysis.Status.ProjectionStartBalance),
        };
        foreach (var row in projection.Rows)
        {
            points.Add(new BalancePoint(row.Date, row.EndingBalance));
        }

        return points;
    }

    private static ComparisonRow Row(LoanAnalysis analysis, string key, string name, ComparisonKind kind, long? id, Scenario? scenario)
    {
        var projection = analysis.Project(scenario);
        var comparison = Simulator.Compare(analysis.Baseline, projection);
        var s = projection.Summary;
        return new ComparisonRow(
            key, name, kind, id,
            s.PaysOff, s.PayoffDate, s.MonthsToPayoff, s.PaymentCount,
            s.TotalInterest, comparison.InterestSaved, comparison.MonthsSaved, comparison.PercentInterestReduction,
            RecurringPayment(projection, analysis.Status.ScheduledPayment),
            projection.Rows.Sum(r => r.ExtraPayment - r.RecurringExtra),
            s.TotalPaid,
            BalanceSeries(analysis, projection));
    }
}
