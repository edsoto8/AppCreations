using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public sealed record ScenarioComparison(
    DateOnly? BaselinePayoffDate,
    DateOnly? NewPayoffDate,
    int MonthsSaved,
    int PaymentsSaved,
    decimal BaselineInterest,
    decimal NewInterest,
    decimal InterestSaved,
    decimal PercentInterestReduction,
    decimal TotalExtraPaid);

public sealed record SimulationResult(Projection Baseline, Projection Scenario, ScenarioComparison Comparison);

public sealed record TargetPayoffResult(
    DateOnly TargetDate,
    bool Achievable,
    string Message,
    decimal? RequiredPayment,
    decimal? AdditionalAmount,
    decimal ScheduledPayment,
    SimulationResult? Simulation);

public sealed record BudgetResult(decimal Budget, decimal ExtraAmount, SimulationResult Simulation);

public static class Simulator
{
    public static SimulationResult Simulate(LoanAnalysis analysis, Scenario scenario)
    {
        var errors = ScenarioValidator.Validate(scenario, analysis, requireName: false, analysis.Format);
        if (errors.Count > 0)
        {
            throw new LoanValidationException(errors);
        }

        var projection = analysis.Project(scenario);
        return new SimulationResult(analysis.Baseline, projection, Compare(analysis.Baseline, projection));
    }

    public static ScenarioComparison Compare(Projection baseline, Projection scenario)
    {
        var b = baseline.Summary;
        var s = scenario.Summary;
        var monthsSaved = b.PayoffDate is { } basePayoff && s.PayoffDate is { } newPayoff
            ? PaymentCalendar.MonthsBetween(newPayoff, basePayoff)
            : 0;
        var interestSaved = b.TotalInterest - s.TotalInterest;
        return new ScenarioComparison(
            b.PayoffDate,
            s.PayoffDate,
            monthsSaved,
            b.PaymentCount - s.PaymentCount,
            b.TotalInterest,
            s.TotalInterest,
            interestSaved,
            b.TotalInterest > 0m ? Money.Percent(interestSaved, b.TotalInterest) : 0m,
            s.TotalExtra);
    }

    /// <summary>
    /// Budget-based payoff: pay <paramref name="budget"/> every period; everything above the scheduled
    /// payment goes to principal.
    /// </summary>
    public static BudgetResult Budget(LoanAnalysis analysis, decimal budget)
    {
        var scenario = new Scenario { Name = "Budget", BudgetPayment = budget };
        var simulation = Simulate(analysis, scenario);
        return new BudgetResult(budget, Money.Round(budget) - analysis.Status.ScheduledPayment, simulation);
    }

    /// <summary>
    /// Smallest regular payment (to the cent) that pays the loan off on or before
    /// <paramref name="target"/>, found by binary search over the real amortization engine so it
    /// honours the loan's accrual method and payment dates exactly.
    /// </summary>
    public static TargetPayoffResult TargetPayoff(LoanAnalysis analysis, DateOnly target)
    {
        var status = analysis.Status;
        var format = analysis.Format;
        var payment = status.ScheduledPayment;

        if (status.IsPaidOff)
        {
            return new TargetPayoffResult(target, true, "This loan is already paid off.", payment, 0m, payment, null);
        }

        if (analysis.Baseline.Summary is { PaysOff: true, PayoffDate: { } basePayoff } && basePayoff <= target)
        {
            var sim = new SimulationResult(analysis.Baseline, analysis.Baseline,
                Compare(analysis.Baseline, analysis.Baseline));
            return new TargetPayoffResult(target, true,
                $"Your current payment already pays the loan off by {format.MonthYear(basePayoff)}, before your target. No extra payment is needed.",
                payment, 0m, payment, sim);
        }

        var firstDue = PaymentCalendar.DueDate(analysis.BaseRequest.FirstPaymentDate, analysis.BaseRequest.Frequency,
            analysis.BaseRequest.FirstPaymentIndex);
        if (target < firstDue)
        {
            var payoff = status.PayoffEstimate;
            return new TargetPayoffResult(target, false,
                $"Your next payment is due {format.LongDate(firstDue)}. To be debt-free before then you would need to pay the loan off " +
                $"in one payment (about {format.Money(payoff.Total)} today — ask your lender for an official payoff quote).",
                null, null, payment, null);
        }

        bool PaysBy(decimal candidate)
        {
            var projection = AmortizationEngine.Run(analysis.BaseRequest with { BudgetPayment = candidate }, format);
            return projection.Summary is { PaysOff: true, PayoffDate: { } date } && date <= target;
        }

        // Upper bound: everything owed plus a full year of interest (no period is longer than a year)
        // always pays the loan off with the first payment.
        var lowCents = (long)(payment * 100m);
        var high = Money.RoundUp(status.ProjectionStartBalance * (1m + (analysis.Loan.AprPercent / 100m)) +
            analysis.BaseRequest.StartingUnpaidInterest + 1m);
        var highCents = (long)(high * 100m);
        while (lowCents < highCents)
        {
            var mid = lowCents + ((highCents - lowCents) / 2);
            if (PaysBy(mid / 100m))
            {
                highCents = mid;
            }
            else
            {
                lowCents = mid + 1;
            }
        }

        var required = highCents / 100m;
        var additional = required - payment;
        var scenario = new Scenario
        {
            Name = $"Pay off by {format.MonthYear(target)}",
            RecurringExtras = [new RecurringExtra(additional)],
        };
        var simulation = Simulate(analysis, scenario);
        var period = analysis.Loan.PaymentFrequency == PaymentFrequency.Monthly ? "month" : "payment";
        var newPayoff = simulation.Scenario.Summary.PayoffDate;
        return new TargetPayoffResult(target, true,
            $"Pay {format.Money(required)} per {period} ({format.Money(additional)} more than your scheduled payment) to be paid off by " +
            $"{(newPayoff is { } d ? format.LongDate(d) : format.LongDate(target))}.",
            required, additional, payment, simulation);
    }
}
