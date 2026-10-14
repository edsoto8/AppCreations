using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class SimulatorTests
{
    private static LoanAnalysis Existing(AccrualMethod method = AccrualMethod.Monthly)
    {
        var loan = TestLoans.Standard();
        loan.CurrentBalance = 18_000m;
        loan.BalanceAsOf = new DateOnly(2026, 10, 5);
        loan.AccrualMethod = method;
        return LoanAnalyzer.Analyze(loan, TestLoans.Today);
    }

    [Fact]
    public void Simulate_ExtraMonthly_ReportsSavings()
    {
        var analysis = Existing();
        var result = Simulator.Simulate(analysis, new Scenario { RecurringExtras = [new RecurringExtra(100m)] });
        var c = result.Comparison;

        Assert.Equal(analysis.Baseline.Summary.TotalInterest - result.Scenario.Summary.TotalInterest, c.InterestSaved);
        Assert.True(c.InterestSaved > 0m);
        Assert.True(c.MonthsSaved > 0);
        Assert.Equal(PaymentCalendar.MonthsBetween(c.NewPayoffDate!.Value, c.BaselinePayoffDate!.Value), c.MonthsSaved);
        Assert.Equal(Money.Percent(c.InterestSaved, c.BaselineInterest), c.PercentInterestReduction);
        Assert.Equal(result.Scenario.Summary.TotalExtra, c.TotalExtraPaid);
    }

    [Fact]
    public void Simulate_CombinedStrategy_BeatsEachPart()
    {
        var analysis = Existing(AccrualMethod.DailySimple);
        var extras = new Scenario { RecurringExtras = [new RecurringExtra(50m), new RecurringExtra(50m, new DateOnly(2027, 6, 1))] };
        var lumps = new Scenario { LumpSums = [new LumpSum(1000m, new DateOnly(2026, 12, 20)), new LumpSum(1500m, new DateOnly(2027, 4, 3))] };
        var combined = new Scenario { RecurringExtras = extras.RecurringExtras, LumpSums = lumps.LumpSums };

        var a = Simulator.Simulate(analysis, extras).Comparison.InterestSaved;
        var b = Simulator.Simulate(analysis, lumps).Comparison.InterestSaved;
        var both = Simulator.Simulate(analysis, combined);
        Assert.True(both.Comparison.InterestSaved > a && both.Comparison.InterestSaved > b);
        Assert.Equal(2, both.Scenario.Rows.Count(r => r.Kind == ScheduleRowKind.LumpSum));
        TestLoans.AssertConsistent(both.Scenario);
    }

    [Fact]
    public void Simulate_InvalidScenario_Throws()
    {
        var ex = Assert.Throws<LoanValidationException>(() =>
            Simulator.Simulate(Existing(), new Scenario { LumpSums = [new LumpSum(100m, new DateOnly(2026, 1, 1))] }));
        Assert.Equal("lumpSums[0].date", ex.Errors[0].Field);
    }

    [Theory]
    [InlineData(AccrualMethod.Monthly)]
    [InlineData(AccrualMethod.DailySimple)]
    public void TargetPayoff_FindsMinimalPayment(AccrualMethod method)
    {
        var analysis = Existing(method);
        var target = new DateOnly(2028, 6, 30);
        var result = Simulator.TargetPayoff(analysis, target);

        Assert.True(result.Achievable);
        Assert.NotNull(result.RequiredPayment);
        Assert.True(result.Simulation!.Scenario.Summary.PayoffDate <= target);
        Assert.Equal(result.RequiredPayment - 483.32m, result.AdditionalAmount);

        // One cent less misses the target: the answer is minimal.
        var oneCentLess = AmortizationEngine.Run(analysis.BaseRequest with { BudgetPayment = result.RequiredPayment - 0.01m });
        Assert.True(oneCentLess.Summary.PayoffDate > target);
    }

    [Fact]
    public void TargetPayoff_ZeroPercent_MatchesSimpleDivision()
    {
        var loan = TestLoans.Standard(12_000m, 0m, 60);
        loan.CurrentBalance = 12_000m;
        loan.BalanceAsOf = new DateOnly(2026, 10, 5);
        var analysis = LoanAnalyzer.Analyze(loan, TestLoans.Today);
        // Nov 2026 … Oct 2027 is 12 payments: 12,000 ÷ 12 = 1,000.
        var result = Simulator.TargetPayoff(analysis, new DateOnly(2027, 10, 1));
        Assert.Equal(1000m, result.RequiredPayment);
    }

    [Fact]
    public void TargetPayoff_AfterBaselinePayoff_NeedsNoExtra()
    {
        var result = Simulator.TargetPayoff(Existing(), new DateOnly(2035, 1, 1));
        Assert.True(result.Achievable);
        Assert.Equal(0m, result.AdditionalAmount);
    }

    [Fact]
    public void TargetPayoff_BeforeNextPayment_IsNotAchievable()
    {
        var result = Simulator.TargetPayoff(Existing(), new DateOnly(2026, 10, 20));
        Assert.False(result.Achievable);
        Assert.Null(result.RequiredPayment);
        Assert.Contains("payoff quote", result.Message);
    }

    [Fact]
    public void Budget_ReportsExtraAndRejectsBelowScheduled()
    {
        var analysis = Existing();
        var result = Simulator.Budget(analysis, 600m);
        Assert.Equal(116.68m, result.ExtraAmount);
        Assert.True(result.Simulation.Comparison.InterestSaved > 0m);

        var ex = Assert.Throws<LoanValidationException>(() => Simulator.Budget(analysis, 400m));
        Assert.Equal("budgetPayment", ex.Errors[0].Field);
    }

    [Fact]
    public void Comparison_PicksBestStrategies()
    {
        var analysis = Existing();
        var saved = new List<Scenario>
        {
            new() { Id = 1, Name = "Big lump", LumpSums = [new LumpSum(8000m, TestLoans.Today)] },
            new() { Id = 2, Name = "Extra 25", RecurringExtras = [new RecurringExtra(25m)] },
            new() { Id = 3, Name = "Stale", LumpSums = [new LumpSum(100m, new DateOnly(2025, 1, 1))] },
        };
        var result = ScenarioComparer.Compare(analysis, saved, budget: 520m);

        Assert.Equal("baseline", result.Rows[0].Key);
        Assert.Contains(result.Rows, r => r.Key == "preset:extra-50");
        Assert.Contains(result.Rows, r => r.Key == "preset:extra-100");
        Assert.Contains(result.Rows, r => r.Key == "preset:lump-2000");
        Assert.DoesNotContain(result.Rows, r => r.Key == "scenario:3");
        Assert.Contains(result.Notes, n => n.Contains("Stale"));

        Assert.Equal("scenario:1", result.Best.LowestInterest);
        Assert.Equal("scenario:1", result.Best.FastestPayoff);
        // Lump-sum strategies keep the scheduled payment, so they win "lowest recurring payment".
        Assert.Equal("scenario:1", result.Best.LowestRecurringPayment);
        // Within $520: baseline 483.32, +25 (508.32) and lumps qualify; the $8,000 lump has the lowest interest.
        Assert.Equal("scenario:1", result.Best.BestWithinBudget);

        var extra25 = result.Rows.Single(r => r.Key == "scenario:2");
        Assert.Equal(508.32m, extra25.RecurringPayment);
        Assert.Equal(analysis.Status.ProjectionStartBalance, extra25.BalanceSeries[0].Balance);
        Assert.Equal(0m, extra25.BalanceSeries[^1].Balance);
    }

    [Fact]
    public void Comparison_WithoutLumpSums_LowestRecurringIsSmallestExtra()
    {
        var analysis = Existing();
        var saved = new List<Scenario> { new() { Id = 7, Name = "Extra 10", RecurringExtras = [new RecurringExtra(10m)] } };
        var result = ScenarioComparer.Compare(analysis, saved, budget: null);
        var lumpPreset = result.Rows.Single(r => r.Key.StartsWith("preset:lump", StringComparison.Ordinal));
        Assert.Equal(483.32m, lumpPreset.RecurringPayment);
        Assert.Equal(lumpPreset.Key, result.Best.LowestRecurringPayment);
        Assert.Null(result.Best.BestWithinBudget);
    }

    [Theory]
    [InlineData(3_000, 500)]
    [InlineData(18_000, 2_000)]
    [InlineData(150_000, 15_000)]
    [InlineData(300, 200)]
    public void SuggestedLumpSum_IsRoundAndBelowBalance(decimal balance, decimal expected) =>
        Assert.Equal(expected, ScenarioComparer.SuggestedLumpSum(balance));
}
