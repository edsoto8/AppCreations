using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

/// <summary>Regression tests for findings from the independent engine review.</summary>
public sealed class ReviewRegressionTests
{
    private static Loan Existing(decimal balance, DateOnly asOf, AccrualMethod method = AccrualMethod.DailySimple,
        PaymentFrequency frequency = PaymentFrequency.Monthly)
    {
        var loan = TestLoans.Standard();
        loan.CurrentBalance = balance;
        loan.BalanceAsOf = asOf;
        loan.AccrualMethod = method;
        loan.PaymentFrequency = frequency;
        return loan;
    }

    [Fact]
    public void DailyLumpSumEqualToBalance_StillChargesAccruedInterest()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(10_000m, new DateOnly(2026, 10, 1)), TestLoans.Today);
        var projection = analysis.Project(new Scenario { LumpSums = [new LumpSum(10_000m, new DateOnly(2026, 10, 20))] });

        // Interest from the Oct 1 due date to Oct 20 = 10,000 × 6% × 19 ÷ 365.
        var accrued = Money.Round(10_000m * 0.06m * 19m / 365m);
        Assert.Equal(accrued, projection.Summary.TotalInterest);
        Assert.Equal(10_000m + accrued, projection.Summary.TotalPaid);
        Assert.True(projection.Summary.PaysOff);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void PayoffInsight_WithStaleBalance_NeverExceedsRemainingInterest()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(15_000m, new DateOnly(2026, 7, 10)), TestLoans.Today);
        var avoided = LoanAnalyzer.InterestAvoidedByPayoff(analysis);

        Assert.True(avoided > 0m);
        Assert.True(avoided <= analysis.Baseline.Summary.TotalInterest);
        var insight = InsightsEngine.Generate(analysis).Single(i => i.Id == "payoff-today");
        Assert.Equal(avoided, insight.Metric!.Value);
    }

    [Fact]
    public void ExistingLoan_DailyAccrual_FirstPeriodRunsFromLastDueDate()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(15_000m, TestLoans.Today), TestLoans.Today);
        var first = analysis.Baseline.Rows[0];

        Assert.Equal(new DateOnly(2026, 11, 1), first.Date);
        Assert.Equal(Money.Round(15_000m * 0.06m * 31m / 365m), first.Interest); // Oct 1 → Nov 1
        Assert.Equal(Money.Round(15_000m * 0.06m * 13m / 365m), analysis.Status.PayoffEstimate.AccruedInterest);
        Assert.Equal(TestLoans.Today, analysis.Status.ProjectionStartDate);
    }

    [Theory]
    [InlineData(500, 60, 240, PaymentFrequency.Monthly)]
    [InlineData(10_000, 100, 240, PaymentFrequency.Monthly)]
    [InlineData(5_000, 36, 240, PaymentFrequency.Weekly)]
    public void StandardPayment_HighRateLongTerm_RepaysWithinTerm(decimal amount, decimal apr, int term, PaymentFrequency frequency)
    {
        var loan = TestLoans.Standard(amount, apr, term);
        loan.PaymentFrequency = frequency;
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.True(projection.Summary.PaysOff);
        // Paying one cent more than the payment that only covers interest shortens such loans a lot;
        // the requirement is that the standard payment repays within the term.
        Assert.InRange(projection.Summary.PaymentCount, 1, frequency.PaymentsForTerm(term));
        Assert.DoesNotContain(projection.Summary.Warnings, w => w.Code is "never-pays-off" or "beyond-maturity" or "balloon-final-payment");
    }

    [Fact]
    public void PaymentEqualToInterest_IsFlaggedAsInsufficient()
    {
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 200m) with { HorizonYears = 1 });
        Assert.Contains(projection.Summary.Warnings, w => w.Code == "insufficient-payment");
    }

    [Fact]
    public void TargetPayoff_LongFirstPeriod_IsCorrectOrUnachievable()
    {
        var loan = TestLoans.Standard(50_000m, 6m, 60, new DateOnly(2023, 3, 1), new DateOnly(2024, 3, 1));
        loan.AccrualMethod = AccrualMethod.DailySimple;
        var analysis = LoanAnalyzer.Analyze(loan, new DateOnly(2024, 1, 1));
        var target = new DateOnly(2024, 3, 15);
        var result = Simulator.TargetPayoff(analysis, target);

        Assert.True(result.Achievable);
        Assert.True(result.Simulation!.Scenario.Summary.PayoffDate <= target);
    }

    [Fact]
    public void BestWithinBudget_BiweeklyComparesMonthlyEquivalent()
    {
        var loan = Existing(20_000m, new DateOnly(2026, 10, 5), AccrualMethod.Monthly, PaymentFrequency.Biweekly);
        loan.FirstPaymentDate = new DateOnly(2024, 1, 15);
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);
        var monthlyEquivalent = Money.Round(analysis.Status.ScheduledPayment * 26m / 12m);

        // A budget just below the baseline's monthly equivalent fits nothing.
        var tight = ScenarioComparer.Compare(analysis, [], monthlyEquivalent - 1m);
        Assert.Null(tight.Best.BestWithinBudget);

        var exact = ScenarioComparer.Compare(analysis, [], monthlyEquivalent);
        Assert.NotNull(exact.Best.BestWithinBudget);
    }

    [Fact]
    public void Refinance_Biweekly_ReportsBreakEvenInCalendarMonths()
    {
        var loan = Existing(25_000m, new DateOnly(2026, 10, 5), AccrualMethod.Monthly, PaymentFrequency.Biweekly);
        loan.AprPercent = 9m;
        loan.FirstPaymentDate = new DateOnly(2024, 1, 15);
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);
        var result = RefinanceCalculator.Compare(analysis, new RefinanceInput(5m, 48, 600m, false));

        Assert.NotNull(result.BreakEvenDate);
        Assert.Equal(PaymentCalendar.MonthsBetween(analysis.Status.ProjectionStartDate, result.BreakEvenDate!.Value), result.BreakEvenMonth);
    }

    [Fact]
    public void Refinance_WhenCurrentLoanNeverPaysOff_HasDedicatedVerdict()
    {
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        loan.ScheduledPayment = 150m;
        var result = RefinanceCalculator.Compare(LoanAnalyzer.Analyze(loan, TestLoans.Today), new RefinanceInput(6m, 60, 0m, false));

        Assert.Contains("never pays", result.Verdict);
        Assert.True(result.LifetimeSavings > 0m);
    }

    [Fact]
    public void Refinance_SameTerms_SaysAboutTheSame()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(18_000m, new DateOnly(2026, 10, 5), AccrualMethod.Monthly), TestLoans.Today);
        var result = RefinanceCalculator.Compare(analysis, new RefinanceInput(6m, analysis.Status.RemainingPayments, 0m, false));
        if (Math.Abs(result.LifetimeSavings) < 0.01m)
        {
            Assert.Contains("about the same", result.Verdict);
        }

        Assert.DoesNotContain("$0.00 more", result.Verdict);
    }

    [Fact]
    public void LumpSumBeyondHorizon_OnNeverPayingLoan_IsNotCalledAfterPayoff()
    {
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan, payment: 100m) with
        {
            LumpSums = [new LumpSum(50m, new DateOnly(2080, 1, 1))],
        });
        Assert.Contains(projection.Summary.Warnings, w => w.Code == "lump-sum-beyond-horizon");
        Assert.DoesNotContain(projection.Summary.Warnings, w => w.Code == "lump-sum-after-payoff");
    }

    [Fact]
    public void PaymentDueToday_IsNextPaymentAndNotYetInPayoffEstimate()
    {
        var analysis = LoanAnalyzer.Analyze(Existing(15_000m, new DateOnly(2026, 10, 1), AccrualMethod.Monthly), new DateOnly(2026, 11, 1));
        Assert.Equal(new DateOnly(2026, 11, 1), analysis.Status.NextPayment!.Date);
        Assert.Equal(15_000m, analysis.Status.PayoffEstimate.Principal);
    }

    [Fact]
    public void TinyLoanAmount_IsRejected()
    {
        var errors = LoanValidator.Validate(TestLoans.Standard(amount: 0.25m, apr: 0m), TestLoans.Today);
        Assert.Contains(errors, e => e.Field == "originalAmount");
    }

    [Fact]
    public void LongFirstPeriodUnderMonthlyAccrual_IsNoted()
    {
        var loan = TestLoans.Standard(start: new DateOnly(2024, 1, 1), firstPayment: new DateOnly(2024, 3, 15));
        var status = LoanAnalyzer.Analyze(loan, TestLoans.Today).Status;
        Assert.Contains(status.Warnings, w => w.Code == "long-first-period");
    }
}
