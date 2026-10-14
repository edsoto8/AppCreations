using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public enum InsightCategory
{
    Progress = 0,
    Projection = 1,
    Savings = 2,
    Warning = 3,
    Refinance = 4,
    Scenario = 5,
}

public enum InsightTone
{
    Positive = 0,
    Neutral = 1,
    Warning = 2,
}

public enum MetricFormat
{
    Currency = 0,
    Percent = 1,
    Months = 2,
    Count = 3,
}

public sealed record InsightMetric(string Label, decimal Value, MetricFormat Format);

public sealed record Insight(
    string Id,
    InsightCategory Category,
    InsightTone Tone,
    string Title,
    string Message,
    string Explanation,
    InsightMetric? Metric);

/// <summary>
/// Rule-based insights. Every figure is produced by running the amortization engine on the user's
/// own loan; nothing is hard-coded. Each insight explains its inputs and method.
/// </summary>
public static class InsightsEngine
{
    /// <summary>Round extra amounts used for suggestions.</summary>
    public static readonly decimal[] ExtraLadder = [25m, 50m, 75m, 100m, 150m, 200m, 250m, 300m, 400m, 500m];

    public static IReadOnlyList<Insight> Generate(LoanAnalysis analysis, IReadOnlyList<Scenario>? saved = null)
    {
        var insights = new List<Insight>();
        var status = analysis.Status;
        var loan = analysis.Loan;
        var f = analysis.Format;
        var baseline = analysis.Baseline;
        var per = loan.PaymentFrequency == PaymentFrequency.Monthly ? "month" : "payment";
        var method = Describe(loan);

        foreach (var warning in status.Warnings.Where(w => w.Severity != Severity.Info))
        {
            insights.Add(new Insight($"warning:{warning.Code}", InsightCategory.Warning, InsightTone.Warning,
                WarningTitle(warning.Code), warning.Message,
                "Raised by the payment engine while projecting your loan with the details you entered.", null));
        }

        if (status.IsPaidOff)
        {
            insights.Add(new Insight("paid-off", InsightCategory.Progress, InsightTone.Positive, "Loan paid off",
                $"You have repaid the full {f.Money(loan.OriginalAmount)} you borrowed.",
                "The current principal balance is zero.", new InsightMetric("Repaid", 100m, MetricFormat.Percent)));
            return insights;
        }

        // Progress
        var balanceSource = status.BalanceIsEstimated
            ? "estimated from the original schedule assuming every payment so far was made on time"
            : $"the balance you entered as of {f.LongDate(status.BalanceAsOf)}";
        insights.Add(new Insight("progress", InsightCategory.Progress, status.PercentRepaid >= 50m ? InsightTone.Positive : InsightTone.Neutral,
            "Repayment progress",
            $"You have repaid {DisplayFormat.Percent(status.PercentRepaid)} of your original principal.",
            $"(Original amount {f.Money(loan.OriginalAmount)} − current balance {f.Money(status.CurrentBalance)}) ÷ {f.Money(loan.OriginalAmount)} " +
            $"= {DisplayFormat.Percent(status.PercentRepaid)}. The current balance is {balanceSource}.",
            new InsightMetric("Principal repaid", status.PercentRepaid, MetricFormat.Percent)));

        // Projection
        if (baseline.Summary is { PaysOff: true, PayoffDate: { } payoff })
        {
            insights.Add(new Insight("projection", InsightCategory.Projection, InsightTone.Neutral, "Projected payoff",
                $"At your current payment rate, you are projected to finish in {f.MonthYear(payoff)}.",
                $"Amortizing {f.Money(status.ProjectionStartBalance)} from {f.LongDate(status.ProjectionStartDate)} at {DisplayFormat.Rate(loan.AprPercent)} APR " +
                $"({method}) with {f.Money(status.ScheduledPayment)} per {per} takes {DisplayFormat.Count(baseline.Summary.PaymentCount)} more payments, " +
                $"the last on {f.LongDate(payoff)}, and {f.Money(baseline.Summary.TotalInterest)} of interest.",
                new InsightMetric("Payments left", baseline.Summary.PaymentCount, MetricFormat.Count)));
        }

        if (!baseline.Summary.PaysOff)
        {
            return insights;
        }

        // Extra monthly payment suggestions
        var suggested = SuggestedExtra(status.ScheduledPayment);
        var extraResult = analysis.Project(new Scenario { Name = "extra", RecurringExtras = [new RecurringExtra(suggested)] });
        var extraCompare = Simulator.Compare(baseline, extraResult);
        if (extraCompare.InterestSaved > 0m)
        {
            var monthsText = extraCompare.MonthsSaved > 0
                ? $"pay off your loan {DisplayFormat.Months(extraCompare.MonthsSaved)} earlier and "
                : "";
            insights.Add(new Insight($"extra-{suggested:0}", InsightCategory.Savings, InsightTone.Positive, "Pay a little extra",
                $"Adding {f.WholeMoney(suggested)} per {per} could {monthsText}save about {f.WholeMoney(extraCompare.InterestSaved)} in interest.",
                $"Same projection as your baseline, with {f.Money(suggested)} added to every payment and applied to principal. " +
                $"Payoff moves from {Date(f, extraCompare.BaselinePayoffDate)} to {Date(f, extraCompare.NewPayoffDate)}; remaining interest falls from " +
                $"{f.Money(extraCompare.BaselineInterest)} to {f.Money(extraCompare.NewInterest)}.",
                new InsightMetric("Interest saved", extraCompare.InterestSaved, MetricFormat.Currency)));
        }

        var larger = ExtraLadder.FirstOrDefault(x => x > suggested);
        if (larger > 0m)
        {
            var largerResult = analysis.Project(new Scenario { Name = "extra", RecurringExtras = [new RecurringExtra(larger)] });
            var largerCompare = Simulator.Compare(baseline, largerResult);
            if (largerCompare.InterestSaved > 0m)
            {
                insights.Add(new Insight($"extra-percent-{larger:0}", InsightCategory.Savings, InsightTone.Positive, "Cut your remaining interest",
                    $"Paying an additional {f.WholeMoney(larger)} per {per} could save approximately {DisplayFormat.Percent(largerCompare.PercentInterestReduction, 0)} of your remaining interest.",
                    $"Interest saved {f.Money(largerCompare.InterestSaved)} ÷ baseline remaining interest {f.Money(largerCompare.BaselineInterest)} " +
                    $"= {DisplayFormat.Percent(largerCompare.PercentInterestReduction)}, with {f.Money(larger)} extra principal on every payment from your next one.",
                    new InsightMetric("Interest reduction", largerCompare.PercentInterestReduction, MetricFormat.Percent)));
            }
        }

        // Lump sum
        var lump = ScenarioComparer.SuggestedLumpSum(status.CurrentBalance);
        var lumpDate = analysis.EffectiveToday;
        if (lump > 0m)
        {
            var lumpResult = analysis.Project(new Scenario { Name = "lump", LumpSums = [new LumpSum(lump, lumpDate)] });
            var lumpCompare = Simulator.Compare(baseline, lumpResult);
            if (lumpCompare.InterestSaved > 0m)
            {
                var when = lumpDate == analysis.Today ? "today" : $"on {f.LongDate(lumpDate)}";
                insights.Add(new Insight($"lump-{lump:0}", InsightCategory.Savings, InsightTone.Positive, "One-time principal payment",
                    $"A {f.WholeMoney(lump)} principal payment {when} could save approximately {f.WholeMoney(lumpCompare.InterestSaved)} in interest" +
                    (lumpCompare.MonthsSaved > 0 ? $" and finish {DisplayFormat.Months(lumpCompare.MonthsSaved)} sooner." : "."),
                    $"A principal-only payment of {f.Money(lump)} {when} ({LumpRule(loan)}), with your regular payment unchanged afterwards. " +
                    $"Remaining interest falls from {f.Money(lumpCompare.BaselineInterest)} to {f.Money(lumpCompare.NewInterest)}.",
                    new InsightMetric("Interest saved", lumpCompare.InterestSaved, MetricFormat.Currency)));
            }
        }

        // Next payment split
        if (status.NextPayment is { Amount: > 0m } next)
        {
            var share = Money.Percent(next.Interest, next.Amount);
            insights.Add(new Insight("next-payment-split", InsightCategory.Projection, InsightTone.Neutral, "Where your next payment goes",
                $"{DisplayFormat.Percent(share, 0)} of your next payment ({f.Money(next.Amount)} on {f.LongDate(next.Date)}) goes to interest; " +
                $"{f.Money(next.Principal)} reduces your balance.",
                $"Interest for the period ending {f.LongDate(next.Date)} is {f.Money(next.Interest)} ({method}); the rest of the payment, " +
                $"{f.Money(next.Principal)}, is applied to principal.",
                new InsightMetric("Interest share", share, MetricFormat.Percent)));
        }

        // Daily cost of interest
        var perDay = Money.Round(InterestAccrual.PerDay(status.CurrentBalance, loan.AprPercent));
        if (perDay > 0m)
        {
            insights.Add(new Insight("interest-per-day", InsightCategory.Projection, InsightTone.Neutral, "Daily interest cost",
                $"Your balance currently costs about {f.Money(perDay)} in interest per day.",
                $"{f.Money(status.CurrentBalance)} × {DisplayFormat.Rate(loan.AprPercent)} ÷ 365 = {f.Money(perDay)}." +
                (loan.AccrualMethod == AccrualMethod.DailySimple
                    ? " Because your loan uses daily simple interest, paying a few days early or making principal payments sooner reduces interest directly."
                    : ""),
                new InsightMetric("Per day", perDay, MetricFormat.Currency)));
        }

        // Paying off today
        var payoffToday = status.PayoffEstimate;
        if (baseline.Summary.TotalInterest > 0m)
        {
            var avoided = LoanAnalyzer.InterestAvoidedByPayoff(analysis);
            var remainingPayments = baseline.Rows.Where(r => r.Date >= payoffToday.Date).Sum(r => r.TotalPayment);
            insights.Add(new Insight("payoff-today", InsightCategory.Savings, InsightTone.Neutral, "Paying off early",
                $"Paying off on {f.LongDate(payoffToday.Date)} would take about {f.Money(payoffToday.Total)} and avoid about {f.Money(avoided)} of future interest.",
                $"Estimated payoff = principal {f.Money(payoffToday.Principal)} + interest accrued to that day {f.Money(payoffToday.AccruedInterest)}. " +
                $"Interest avoided = scheduled payments still due from that day {f.Money(remainingPayments)} − payoff amount. " +
                "This is an estimate: your lender's official payoff quote may include fees and per-diem interest up to the day funds post.",
                new InsightMetric("Interest avoided", avoided, MetricFormat.Currency)));
        }

        // Rate sensitivity
        if (loan.AprPercent >= 2m && baseline.Summary.PaymentCount > 1)
        {
            var lower = loan.AprPercent - 1m;
            var payments = baseline.Summary.PaymentCount;
            var principal = status.ProjectionStartBalance + analysis.BaseRequest.StartingUnpaidInterest;
            var lowerPayment = PaymentMath.StandardPayment(principal, lower, loan.PaymentFrequency, payments);
            var lowerRun = AmortizationEngine.Run(analysis.BaseRequest with
            {
                AprPercent = lower,
                ScheduledPayment = lowerPayment,
                ContractPaymentCount = analysis.BaseRequest.FirstPaymentIndex + payments,
            }, f);
            var saved1 = baseline.Summary.TotalInterest - lowerRun.Summary.TotalInterest;
            if (saved1 > 0m)
            {
                insights.Add(new Insight("rate-sensitivity", InsightCategory.Refinance, InsightTone.Neutral, "Rate sensitivity",
                    $"A rate one percentage point lower ({DisplayFormat.Rate(lower)}) would save about {f.WholeMoney(saved1)} over your remaining {DisplayFormat.Count(payments)} payments, before any refinancing fees.",
                    $"Re-amortizing {f.Money(principal)} over the same {DisplayFormat.Count(payments)} payments at {DisplayFormat.Rate(lower)} gives a payment of " +
                    $"{f.Money(lowerPayment)} and {f.Money(lowerRun.Summary.TotalInterest)} of interest, versus {f.Money(baseline.Summary.TotalInterest)} today. " +
                    "Use the refinance calculator to include fees and a different term.",
                    new InsightMetric("Savings per 1% APR", saved1, MetricFormat.Currency)));
            }
        }

        // Equity
        if (status.Equity is { } equity && status.VehicleValue is { } value)
        {
            insights.Add(equity >= 0m
                ? new Insight("equity", InsightCategory.Progress, InsightTone.Positive, "Vehicle equity",
                    $"You have about {f.WholeMoney(equity)} of equity in your vehicle.",
                    $"Vehicle value you entered {f.Money(value)} − estimated payoff {f.Money(status.PayoffEstimate.Total)} = {f.Money(equity)}.",
                    new InsightMetric("Equity", equity, MetricFormat.Currency))
                : new Insight("equity", InsightCategory.Warning, InsightTone.Warning, "Negative equity",
                    $"You owe about {f.WholeMoney(-equity)} more than the vehicle is worth.",
                    $"Vehicle value you entered {f.Money(value)} − estimated payoff {f.Money(status.PayoffEstimate.Total)} = {f.Money(equity)}. " +
                    "Extra principal payments close this gap fastest.",
                    new InsightMetric("Equity", equity, MetricFormat.Currency)));
        }

        // Saved scenarios
        if (saved is { Count: > 0 })
        {
            var best = saved
                .Where(s => ScenarioValidator.Validate(s, analysis, requireName: false, f).Count == 0)
                .Select(s => (Scenario: s, Compare: Simulator.Compare(baseline, analysis.Project(s))))
                .Where(x => x.Compare.InterestSaved > 0m)
                .OrderByDescending(x => x.Compare.InterestSaved)
                .FirstOrDefault();
            if (best.Scenario is not null)
            {
                insights.Add(new Insight($"scenario-best-{best.Scenario.Id}", InsightCategory.Scenario, InsightTone.Positive, "Your best saved strategy",
                    $"Your scenario \"{best.Scenario.Name}\" saves the most interest: about {f.WholeMoney(best.Compare.InterestSaved)}" +
                    (best.Compare.MonthsSaved > 0 ? $", finishing {DisplayFormat.Months(best.Compare.MonthsSaved)} early." : "."),
                    $"Each saved scenario was projected against your baseline; \"{best.Scenario.Name}\" lowers remaining interest from " +
                    $"{f.Money(best.Compare.BaselineInterest)} to {f.Money(best.Compare.NewInterest)} and pays off on {Date(f, best.Compare.NewPayoffDate)}.",
                    new InsightMetric("Interest saved", best.Compare.InterestSaved, MetricFormat.Currency)));
            }
        }

        return insights;
    }

    /// <summary>The ladder amount closest to 10 % of the payment (at least $25).</summary>
    public static decimal SuggestedExtra(decimal scheduledPayment)
    {
        var target = scheduledPayment * 0.10m;
        return ExtraLadder.OrderBy(x => Math.Abs(x - target)).ThenBy(x => x).First();
    }

    private static string Describe(Loan loan) => loan.AccrualMethod == AccrualMethod.DailySimple
        ? $"daily simple interest, {(loan.DayCountBasis == DayCountBasis.Actual365 ? "Actual/365" : "Actual/Actual")}"
        : $"interest of APR ÷ {loan.PaymentFrequency.PeriodsPerYear()} per period";

    private static string LumpRule(Loan loan) => loan.AccrualMethod == AccrualMethod.DailySimple
        ? "daily interest stops accruing on that principal from the payment date"
        : "credited with your next scheduled payment, so it reduces interest from the following period";

    private static string Date(DisplayFormat f, DateOnly? date) => date is { } d ? f.LongDate(d) : "never";

    private static string WarningTitle(string code) => code switch
    {
        "insufficient-payment" => "Payment does not cover interest",
        "never-pays-off" => "Loan never pays off",
        "balloon-final-payment" => "Large final payment",
        "beyond-maturity" => "Payoff later than scheduled",
        "stale-balance" => "Balance needs updating",
        "balance-exceeds-original" => "Balance above original amount",
        _ => "Check your loan details",
    };
}
