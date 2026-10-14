using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class AmortizationEngineTests
{
    [Fact]
    public void PaymentBelowInterest_CarriesUnpaidInterestWithoutCapitalizing()
    {
        // $20,000 at 12%: monthly interest is $200; a $150 payment cannot cover it.
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 150m) with { HorizonYears = 2 });

        Assert.False(projection.Summary.PaysOff);
        Assert.All(projection.Rows, r => Assert.Equal(20_000m, r.EndingBalance)); // principal never moves
        Assert.All(projection.Rows, r => Assert.Equal(200m, r.Interest)); // interest is not charged on interest
        Assert.Equal(50m * projection.Rows.Count, projection.Rows[^1].UnpaidInterest);
        Assert.Contains(projection.Summary.Warnings, w => w is { Code: "insufficient-payment", Severity: Severity.Critical });
        Assert.Contains(projection.Summary.Warnings, w => w.Code == "never-pays-off");
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void InsufficientPaymentThenExtras_PaysUnpaidInterestBeforePrincipal()
    {
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 150m) with
        {
            RecurringExtras = [new RecurringExtra(400m, StartDate: new DateOnly(2024, 4, 1))],
        });

        var third = projection.Rows[2]; // first payment with the extra: owes $100 carried + $200 interest
        Assert.Equal(550m, third.TotalPayment);
        Assert.Equal(250m, third.Principal);
        Assert.Equal(0m, third.UnpaidInterest);
        Assert.True(projection.Summary.PaysOff);
        Assert.Contains(projection.Summary.Warnings, w => w is { Code: "insufficient-payment", Severity: Severity.Warning });
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void ExtraPayments_NeverReduceLaterScheduledPayments()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with
        {
            LumpSums = [new LumpSum(5000m, new DateOnly(2024, 6, 1))],
            RecurringExtras = [new RecurringExtra(75m)],
        });

        Assert.All(projection.Rows.Take(projection.Rows.Count - 1), r => Assert.Equal(483.32m, r.ScheduledPayment));
        Assert.True(projection.Summary.PaymentCount < 60);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void FinalPayment_IsSmallerThanRegularAndBalanceNeverNegative()
    {
        var loan = TestLoans.Standard(10_000m, 5m, 36);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with { RecurringExtras = [new RecurringExtra(250m)] });

        Assert.True(projection.Summary.FinalPayment < projection.Rows[0].TotalPayment);
        Assert.Equal(0m, projection.Rows[^1].EndingBalance);
        Assert.Equal(projection.Rows[^1].StartingBalance + projection.Rows[^1].Interest, projection.Rows[^1].TotalPayment);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void RecurringExtraWindows_ApplyOnlyWithinTheirDates()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with
        {
            RecurringExtras =
            [
                new RecurringExtra(50m, new DateOnly(2024, 3, 1), new DateOnly(2024, 5, 1)),
                new RecurringExtra(100m, new DateOnly(2024, 5, 1)),
            ],
        });

        Assert.Equal([0m, 50m, 50m, 150m, 100m], projection.Rows.Take(5).Select(r => r.ExtraPayment));
        Assert.Equal([0m, 50m, 50m, 150m, 100m], projection.Rows.Take(5).Select(r => r.RecurringExtra));
    }

    [Fact]
    public void BudgetPayment_AppliesSurplusAsExtraPrincipal()
    {
        var loan = TestLoans.Standard();
        var budget = AmortizationEngine.Run(TestLoans.Request(loan) with { BudgetPayment = 583.32m });
        var extra = AmortizationEngine.Run(TestLoans.Request(loan) with { RecurringExtras = [new RecurringExtra(100m)] });

        Assert.Equal(extra.Summary.TotalInterest, budget.Summary.TotalInterest);
        Assert.Equal(extra.Summary.PayoffDate, budget.Summary.PayoffDate);
        Assert.Equal(100m, budget.Rows[0].ExtraPayment);
    }

    [Fact]
    public void LumpSumLargerThanOwed_IsCappedAndLoanEnds()
    {
        var loan = TestLoans.Standard(5_000m, 6m, 24);
        var monthly = AmortizationEngine.Run(TestLoans.Request(loan) with { LumpSums = [new LumpSum(50_000m, new DateOnly(2024, 1, 20))] });

        Assert.Single(monthly.Rows);
        Assert.Equal(5025m, monthly.Rows[0].TotalPayment); // 5000 + one month of interest
        Assert.Contains(monthly.Summary.Warnings, w => w.Code == "lump-sum-capped");

        loan.AccrualMethod = AccrualMethod.DailySimple;
        var daily = AmortizationEngine.Run(TestLoans.Request(loan) with { LumpSums = [new LumpSum(50_000m, new DateOnly(2024, 1, 20))] });
        var row = Assert.Single(daily.Rows);
        Assert.Equal(ScheduleRowKind.LumpSum, row.Kind);
        Assert.Equal(Money.Round(5000m * 0.06m * 19m / 365m), row.Interest);
        Assert.Equal(5000m + row.Interest, row.TotalPayment);
        Assert.True(daily.Summary.PaysOff);
        TestLoans.AssertConsistent(daily);
    }

    [Fact]
    public void LumpSumAfterPayoff_IsReportedNotApplied()
    {
        var loan = TestLoans.Standard(5_000m, 6m, 12);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with { LumpSums = [new LumpSum(100m, new DateOnly(2030, 1, 1))] });

        Assert.Equal(0m, projection.Summary.TotalExtra);
        Assert.Contains(projection.Summary.Warnings, w => w.Code == "lump-sum-after-payoff");
    }

    [Fact]
    public void SlightlyLowPayment_FoldsResidualIntoFinalPayment()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 480m));

        Assert.Equal(60, projection.Summary.PaymentCount);
        Assert.True(projection.Summary.FinalPayment > 480m);
        Assert.Contains(projection.Summary.Warnings, w => w.Code is "final-payment-adjusted" or "balloon-final-payment");
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void MuchLowerPayment_ContinuesPastMaturityWithWarning()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 300m));

        Assert.True(projection.Summary.PaysOff);
        Assert.True(projection.Summary.PaymentCount > 60);
        Assert.Contains(projection.Summary.Warnings, w => w.Code == "beyond-maturity");
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void Biweekly_StepsFourteenDaysAndUsesTwentySixPeriods()
    {
        var loan = TestLoans.Standard(20_000m, 5m, 48);
        loan.PaymentFrequency = PaymentFrequency.Biweekly;
        var request = TestLoans.Request(loan);
        var projection = AmortizationEngine.Run(request);

        Assert.Equal(104, request.ContractPaymentCount);
        Assert.Equal(new DateOnly(2024, 2, 15), projection.Rows[1].Date);
        Assert.Equal(Money.Round(20_000m * 0.05m / 26m), projection.Rows[0].Interest);
        Assert.Equal(104, projection.Summary.PaymentCount);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void ZeroBalance_ProducesNoRowsAndIsPaidOff()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with { StartingBalance = 0m });

        Assert.Empty(projection.Rows);
        Assert.True(projection.Summary.PaysOff);
        Assert.Equal(0m, projection.Summary.TotalInterest);
    }
}
