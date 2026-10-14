using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class LoanAnalyzerTests
{
    private static Loan Existing(decimal balance = 18_000m, DateOnly? asOf = null)
    {
        var loan = TestLoans.Standard();
        loan.CurrentBalance = balance;
        loan.BalanceAsOf = asOf ?? new DateOnly(2026, 10, 5);
        return loan;
    }

    [Fact]
    public void ExistingLoan_ProjectsFromBalanceDateWithoutInventingHistory()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(), TestLoans.Today);
        var status = analysis.Status;

        Assert.Equal(18_000m, status.CurrentBalance);
        Assert.False(status.BalanceIsEstimated);
        Assert.Equal(new DateOnly(2026, 10, 5), status.ProjectionStartDate);
        Assert.Null(status.InterestPaidToDate);
        Assert.Equal(InterestPaidSource.Unknown, status.InterestPaidSource);
        Assert.Null(status.ProjectedLifetimeCost);
        Assert.Empty(analysis.History);
        Assert.False(analysis.CumulativeInterestFromOrigination);

        // Payments due Feb 2024 … Oct 2026 = 33, so the next is #34 on Nov 1, 2026.
        Assert.Equal(34, status.NextPaymentNumber);
        Assert.Equal(33, status.PaymentsMade);
        Assert.True(status.PaymentsMadeIsEstimated);
        Assert.Equal(new DateOnly(2026, 11, 1), status.NextPayment!.Date);
        Assert.Equal(90m, status.NextPayment.Interest); // 18,000 × 6% ÷ 12

        Assert.Equal(28m, status.PercentRepaid); // (25,000 − 18,000) ÷ 25,000
        Assert.Equal(7_000m, status.PrincipalRepaid);
        var independent = AmortizationEngine.Run(new AmortizationRequest
        {
            StartingBalance = 18_000m, StartDate = new DateOnly(2026, 10, 5), FirstPaymentDate = new DateOnly(2026, 11, 1),
            FirstPaymentIndex = 0, ScheduledPayment = 483.32m, AprPercent = 6m,
        });
        Assert.Equal(independent.Summary.TotalInterest, status.RemainingInterest);
        Assert.Equal(independent.Summary.PaymentCount, status.RemainingPayments);
    }

    [Fact]
    public void ExistingLoan_UsesEnteredInterestAndPaymentsMade()
    {
        var loan = Existing();
        loan.InterestPaidToDate = 2_400m;
        loan.PaymentsMade = 32;
        var status = LoanAnalyzer.Analyze(loan, TestLoans.Today).Status;

        Assert.Equal(2_400m, status.InterestPaidToDate);
        Assert.Equal(InterestPaidSource.Entered, status.InterestPaidSource);
        Assert.Equal(32, status.PaymentsMade);
        Assert.False(status.PaymentsMadeIsEstimated);
        Assert.Equal(25_000m + 2_400m + status.RemainingInterest, status.ProjectedLifetimeCost);
        Assert.False(status.LifetimeCostIsEstimated);
    }

    [Fact]
    public void ExistingLoan_PartialPaymentRecords_DoNotCountAsKnownInterest()
    {
        var records = new List<PaymentRecord>
        {
            new() { Date = new DateOnly(2024, 2, 1), Amount = 483.32m, Interest = 125m, Principal = 358.32m },
            new() { Date = new DateOnly(2024, 3, 1), Amount = 483.32m },
        };
        var status = LoanAnalyzer.Analyze(Existing(), TestLoans.Today, records).Status;

        Assert.Null(status.InterestPaidToDate);
        Assert.Equal(InterestPaidSource.Unknown, status.InterestPaidSource);
        Assert.Null(status.ProjectedLifetimeCost);
    }

    [Fact]
    public void ExistingLoan_CompletePaymentRecords_GiveInterestPaid()
    {
        var loan = Existing();
        loan.PaymentsMade = 2;
        var records = new List<PaymentRecord>
        {
            new() { Date = new DateOnly(2024, 2, 1), Amount = 483.32m, Interest = 125m, Principal = 358.32m },
            new() { Date = new DateOnly(2024, 3, 1), Amount = 483.32m, Interest = 123.21m, Principal = 360.11m },
            new() { Date = new DateOnly(2026, 11, 1), Amount = 483.32m }, // after the as-of date: ignored
        };
        var status = LoanAnalyzer.Analyze(loan, TestLoans.Today, records).Status;

        Assert.Equal(248.21m, status.InterestPaidToDate);
        Assert.Equal(InterestPaidSource.Records, status.InterestPaidSource);
    }

    [Fact]
    public void NoBalance_EstimatesFromScheduleAndLabelsIt()
    {
        var loan = TestLoans.Standard();
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);
        var status = analysis.Status;
        var original = analysis.OriginalSchedule.Rows;

        Assert.True(status.BalanceIsEstimated);
        Assert.Equal(33, status.PaymentsMade);
        Assert.Equal(original[32].EndingBalance, status.CurrentBalance);
        Assert.Equal(original[32].CumulativeInterest, status.InterestPaidToDate);
        Assert.Equal(InterestPaidSource.Estimated, status.InterestPaidSource);
        Assert.True(status.LifetimeCostIsEstimated);
        Assert.Equal(33, analysis.History.Count);
        Assert.All(analysis.History, r => Assert.True(r.IsEstimated));
        Assert.Contains(status.Warnings, w => w.Code == "estimated-balance");

        // History + projection reproduce the original schedule exactly.
        Assert.Equal(original.Skip(33).Select(r => (r.Date, r.Interest, r.EndingBalance)),
            analysis.Baseline.Rows.Select(r => (r.Date, r.Interest, r.EndingBalance)));
        Assert.Equal(status.OriginalScheduleTotalInterest, status.InterestPaidToDate + status.RemainingInterest);
    }

    [Fact]
    public void NoBalance_PaymentsMadeOverridesCalendar()
    {
        var loan = TestLoans.Standard();
        loan.PaymentsMade = 10;
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);

        Assert.Equal(analysis.OriginalSchedule.Rows[9].EndingBalance, analysis.Status.CurrentBalance);
        Assert.Equal(11, analysis.Status.NextPaymentNumber);
        Assert.False(analysis.Status.PaymentsMadeIsEstimated);
    }

    [Fact]
    public void NewLoanBeforeFirstPayment_HasNoHistory()
    {
        var loan = TestLoans.Standard(start: new DateOnly(2026, 10, 1), firstPayment: new DateOnly(2026, 11, 1));
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);

        Assert.Equal(25_000m, analysis.Status.CurrentBalance);
        Assert.Equal(0m, analysis.Status.PercentRepaid);
        Assert.Equal(60, analysis.Status.RemainingPayments);
        Assert.Equal(0m, analysis.Status.InterestPaidToDate);
        Assert.Equal(analysis.Status.OriginalScheduleTotalInterest, analysis.Status.RemainingInterest);
    }

    [Fact]
    public void ScheduleCompleted_IsPaidOff()
    {
        var loan = TestLoans.Standard(term: 12);
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);

        Assert.True(analysis.Status.IsPaidOff);
        Assert.Empty(analysis.Baseline.Rows);
        Assert.Equal(100m, analysis.Status.PercentRepaid);
        Assert.Contains(analysis.Status.Warnings, w => w.Code == "paid-off");
    }

    [Fact]
    public void ZeroBalanceEntered_IsPaidOff()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(0m), TestLoans.Today);
        Assert.True(analysis.Status.IsPaidOff);
        Assert.Null(analysis.Status.NextPayment);
    }

    [Fact]
    public void NextPayment_IsFirstDueOnOrAfterToday()
    {
        // Projection starts Aug 20; Sep 1 and Oct 1 are assumed paid by Oct 14, so Nov 1 (#34) is next.
        var status = LoanAnalyzer.Analyze(Existing(asOf: new DateOnly(2026, 8, 20)), TestLoans.Today).Status;
        Assert.Equal(32, status.NextPaymentNumber);
        Assert.Equal(new DateOnly(2026, 11, 1), status.NextPayment!.Date);
        Assert.Equal(34, status.NextPayment.Number);
    }

    [Fact]
    public void StaleBalance_IsFlagged()
    {
        var status = LoanAnalyzer.Analyze(Existing(asOf: new DateOnly(2026, 6, 1)), TestLoans.Today).Status;
        Assert.Contains(status.Warnings, w => w is { Code: "stale-balance", Severity: Severity.Warning });
    }

    [Fact]
    public void PayoffEstimate_DailyAccrualAddsInterestSinceLastDueDate()
    {
        var loan = Existing();
        loan.AccrualMethod = AccrualMethod.DailySimple;
        var estimate = LoanAnalyzer.Analyze(loan, TestLoans.Today).Status.PayoffEstimate;

        Assert.Equal(TestLoans.Today, estimate.Date);
        Assert.Equal(18_000m, estimate.Principal);
        // The last payment was due Oct 1, so 13 days have accrued by Oct 14 (not 9 days since the Oct 5 balance date).
        Assert.Equal(Money.Round(18_000m * 0.06m * 13m / 365m), estimate.AccruedInterest);
        Assert.Equal(estimate.Principal + estimate.AccruedInterest, estimate.Total);
    }

    [Fact]
    public void EnteredPaymentDifferentFromStandard_IsNotedAndUsed()
    {
        var loan = TestLoans.Standard();
        loan.ScheduledPayment = 510m;
        var status = LoanAnalyzer.Analyze(loan, TestLoans.Today).Status;

        Assert.Equal(510m, status.ScheduledPayment);
        Assert.Equal(483.32m, status.StandardPayment);
        Assert.False(status.PaymentIsStandard);
        Assert.Contains(status.Warnings, w => w.Code == "payment-differs");
    }

    [Fact]
    public void VehicleValue_ProducesEquity()
    {
        var loan = Existing();
        loan.VehicleValue = 20_000m;
        var status = LoanAnalyzer.Analyze(loan, TestLoans.Today).Status;
        Assert.Equal(20_000m - status.PayoffEstimate.Total, status.Equity);
    }

    [Fact]
    public void InvalidLoan_Throws()
    {
        var loan = TestLoans.Standard(amount: 0m);
        var ex = Assert.Throws<LoanValidationException>(() => LoanAnalyzer.Analyze(loan, TestLoans.Today));
        Assert.Contains(ex.Errors, e => e.Field == "originalAmount");
    }
}
