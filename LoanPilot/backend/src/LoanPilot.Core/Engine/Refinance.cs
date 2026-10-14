using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public sealed record RefinanceInput(decimal NewAprPercent, int NewTermMonths, decimal Fees, bool FeesFinanced);

public sealed record CurrentLoanSide(decimal Payment, int RemainingPayments, decimal RemainingInterest, decimal TotalRemainingCost, DateOnly? PayoffDate);

public sealed record RefinancedSide(decimal Principal, decimal Payment, int Payments, decimal TotalInterest, decimal Fees, decimal TotalCost, DateOnly? PayoffDate);

public sealed record RateComparisonRow(decimal AprPercent, decimal Payment, decimal TotalInterest, decimal LifetimeSavings);

public sealed record CostPoint(int Month, DateOnly Date, decimal CurrentCost, decimal RefinanceCost);

public sealed record RefinanceResult(
    CurrentLoanSide Current,
    RefinancedSide Refinanced,
    decimal MonthlyPaymentChange,
    decimal LifetimeSavings,
    int? BreakEvenMonth,
    DateOnly? BreakEvenDate,
    string Verdict,
    IReadOnlyList<RateComparisonRow> RateComparison,
    IReadOnlyList<CostPoint> CostSeries);

/// <summary>
/// Compares keeping the loan with refinancing the same principal at the same point in time. The new
/// loan starts where the baseline projection starts (same balance, same first due date and payment
/// frequency) so both sides are measured from an identical position.
/// </summary>
public static class RefinanceCalculator
{
    public static IReadOnlyList<ValidationError> Validate(RefinanceInput input)
    {
        var errors = new List<ValidationError>();
        if (input.NewAprPercent is < 0m or > LoanValidator.MaxAprPercent)
        {
            errors.Add(new ValidationError("newAprPercent", "Enter the new APR as a percentage between 0 and 100."));
        }

        if (input.NewTermMonths is < 1 or > LoanValidator.MaxTermMonths)
        {
            errors.Add(new ValidationError("newTermMonths", $"The new term must be between 1 and {LoanValidator.MaxTermMonths} months."));
        }

        if (input.Fees is < 0m or > LoanValidator.MaxAmount)
        {
            errors.Add(new ValidationError("fees", "Fees must be zero or more."));
        }

        return errors;
    }

    public static RefinanceResult Compare(LoanAnalysis analysis, RefinanceInput input)
    {
        var errors = Validate(input);
        if (errors.Count > 0)
        {
            throw new LoanValidationException(errors);
        }

        var format = analysis.Format;
        var baseline = analysis.Baseline;
        var currentOwed = analysis.Status.ProjectionStartBalance + analysis.BaseRequest.StartingUnpaidInterest;
        // A loan that never pays off still owes its ending balance at the projection horizon.
        var current = new CurrentLoanSide(analysis.Status.ScheduledPayment, baseline.Summary.PaymentCount,
            baseline.Summary.TotalInterest, baseline.Summary.TotalPaid + baseline.EndingOwed, baseline.Summary.PayoffDate);

        var (refinanced, newProjection) = Refinanced(analysis, input, input.NewAprPercent);
        var upfront = input.FeesFinanced ? 0m : Money.Round(input.Fees);
        var lifetimeSavings = current.TotalRemainingCost - refinanced.TotalCost;

        // Position after month m = everything paid so far (+ upfront fees) + what is still owed.
        var series = new List<CostPoint>();
        var months = Math.Max(baseline.Rows.Count, newProjection.Rows.Count);
        decimal paidCurrent = 0m, paidNew = upfront;
        var owedCurrent = currentOwed;
        var owedNew = refinanced.Principal;
        series.Add(new CostPoint(0, analysis.Status.ProjectionStartDate, owedCurrent, paidNew + owedNew));
        var currentPayments = baseline.Rows.Where(r => r.Kind == ScheduleRowKind.Payment).ToList();
        var newPayments = newProjection.Rows.Where(r => r.Kind == ScheduleRowKind.Payment).ToList();
        for (var m = 1; m <= months; m++)
        {
            if (m <= currentPayments.Count)
            {
                paidCurrent += currentPayments[m - 1].TotalPayment;
                owedCurrent = currentPayments[m - 1].EndingBalance + currentPayments[m - 1].UnpaidInterest;
            }

            if (m <= newPayments.Count)
            {
                paidNew += newPayments[m - 1].TotalPayment;
                owedNew = newPayments[m - 1].EndingBalance + newPayments[m - 1].UnpaidInterest;
            }

            var date = m <= newPayments.Count ? newPayments[m - 1].Date
                : m <= currentPayments.Count ? currentPayments[m - 1].Date
                : series[^1].Date;
            series.Add(new CostPoint(m, date, paidCurrent + owedCurrent, paidNew + owedNew));
        }

        // Break-even: the first month from which refinancing stays at or below the cost of keeping the loan.
        int? breakEven = null;
        for (var i = series.Count - 1; i >= 0 && series[i].RefinanceCost <= series[i].CurrentCost; i--)
        {
            breakEven = series[i].Month;
        }

        DateOnly? breakEvenDate = breakEven is { } be ? series[be].Date : null;

        // Series points are payment periods; report break-even in calendar months.
        int? breakEvenMonths = breakEvenDate is { } bd
            ? Math.Max(0, PaymentCalendar.MonthsBetween(analysis.Status.ProjectionStartDate, bd))
            : null;

        var rates = new List<RateComparisonRow>();
        for (var delta = -2m; delta <= 2m; delta += 0.5m)
        {
            var apr = input.NewAprPercent + delta;
            if (apr < 0m || apr > LoanValidator.MaxAprPercent)
            {
                continue;
            }

            var (side, _) = Refinanced(analysis, input, apr);
            rates.Add(new RateComparisonRow(apr, side.Payment, side.TotalInterest, current.TotalRemainingCost - side.TotalCost));
        }

        var paymentChange = refinanced.Payment - current.Payment;
        string verdict;
        if (analysis.Status.IsPaidOff)
        {
            verdict = "This loan is already paid off, so there is nothing to refinance.";
        }
        else if (!baseline.Summary.PaysOff)
        {
            verdict = $"Your current payment never pays this loan off, so any refinance that does is an improvement: at {DisplayFormat.Rate(input.NewAprPercent)} " +
                $"the payment would be {format.Money(refinanced.Payment)}. Talk to your lender soon.";
        }
        else if (Math.Abs(lifetimeSavings) < 0.01m)
        {
            verdict = "Refinancing on these terms costs about the same as keeping your current loan.";
        }
        else if (lifetimeSavings > 0m && breakEvenMonths is { } month)
        {
            verdict = $"Refinancing would save about {format.Money(lifetimeSavings)} overall" +
                (month > 0 ? $" and pays back its costs after {DisplayFormat.Months(month)}" : "") +
                (paymentChange < 0m ? $", lowering your payment by {format.Money(-paymentChange)}." : ".");
        }
        else if (paymentChange < 0m)
        {
            verdict = $"Refinancing lowers your payment by {format.Money(-paymentChange)} but costs {format.Money(-lifetimeSavings)} more overall, " +
                "mainly because of the longer term or fees.";
        }
        else
        {
            verdict = $"Refinancing on these terms would cost {format.Money(-lifetimeSavings)} more than keeping your current loan.";
        }

        return new RefinanceResult(current, refinanced, paymentChange, lifetimeSavings, breakEvenMonths, breakEvenDate, verdict, rates, series);
    }

    private static (RefinancedSide Side, Projection Projection) Refinanced(LoanAnalysis analysis, RefinanceInput input, decimal apr)
    {
        var request = analysis.BaseRequest;
        var fees = Money.Round(input.Fees);
        var principal = analysis.Status.ProjectionStartBalance + request.StartingUnpaidInterest + (input.FeesFinanced ? fees : 0m);
        var frequency = analysis.Loan.PaymentFrequency;
        var payments = frequency.PaymentsForTerm(input.NewTermMonths);
        var payment = PaymentMath.StandardPayment(principal, apr, frequency, payments);
        var firstDue = PaymentCalendar.DueDate(request.FirstPaymentDate, frequency, request.FirstPaymentIndex);
        var newRequest = request with
        {
            StartingBalance = principal,
            StartingUnpaidInterest = 0m,
            StartingCumulativeInterest = 0m,
            FirstPaymentDate = firstDue,
            FirstPaymentIndex = 0,
            ScheduledPayment = payment,
            AprPercent = apr,
            ContractPaymentCount = payments,
            BudgetPayment = null,
            RecurringExtras = [],
            LumpSums = [],
        };
        var projection = AmortizationEngine.Run(newRequest, analysis.Format);
        var upfront = input.FeesFinanced ? 0m : fees;
        var side = new RefinancedSide(principal, payment, projection.Summary.PaymentCount, projection.Summary.TotalInterest,
            fees, projection.Summary.TotalPaid + upfront, projection.Summary.PayoffDate);
        return (side, projection);
    }
}
