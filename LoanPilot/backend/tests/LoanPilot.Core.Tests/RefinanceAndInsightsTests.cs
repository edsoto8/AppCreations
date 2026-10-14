using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class RefinanceAndInsightsTests
{
    private static LoanAnalysis Existing(decimal apr = 9m, decimal? vehicleValue = null)
    {
        var loan = TestLoans.Standard(30_000m, apr, 72);
        loan.CurrentBalance = 22_000m;
        loan.BalanceAsOf = new DateOnly(2026, 10, 5);
        loan.VehicleValue = vehicleValue;
        return LoanAnalyzer.Analyze(loan, TestLoans.Today);
    }

    [Fact]
    public void Refinance_LowerRateSameTerm_SavesMoneyAndBreaksEven()
    {
        var analysis = Existing();
        var remaining = analysis.Status.RemainingPayments;
        var result = RefinanceCalculator.Compare(analysis, new RefinanceInput(5m, remaining, 300m, FeesFinanced: false));

        Assert.True(result.LifetimeSavings > 0m);
        Assert.True(result.MonthlyPaymentChange < 0m);
        Assert.NotNull(result.BreakEvenMonth);
        Assert.True(result.BreakEvenMonth > 0);
        Assert.Equal(result.Current.TotalRemainingCost - result.Refinanced.TotalCost, result.LifetimeSavings);
        Assert.Equal(PaymentMath.StandardPayment(22_000m, 5m, PaymentFrequency.Monthly, remaining), result.Refinanced.Payment);
        Assert.Equal(result.Refinanced.TotalInterest + 22_000m + 300m, result.Refinanced.TotalCost);

        // Break-even: from that month on refinancing is never more expensive.
        Assert.All(result.CostSeries.Where(p => p.Month >= result.BreakEvenMonth), p => Assert.True(p.RefinanceCost <= p.CurrentCost));
        Assert.True(result.CostSeries.Single(p => p.Month == result.BreakEvenMonth - 1).RefinanceCost > result.CostSeries.Single(p => p.Month == result.BreakEvenMonth - 1).CurrentCost);
        Assert.Contains(result.RateComparison, r => r.AprPercent == 5m && r.Payment == result.Refinanced.Payment);
    }

    [Fact]
    public void Refinance_FinancedFees_AreAddedToPrincipal()
    {
        var result = RefinanceCalculator.Compare(Existing(), new RefinanceInput(5m, 48, 500m, FeesFinanced: true));
        Assert.Equal(22_500m, result.Refinanced.Principal);
        Assert.Equal(result.Refinanced.TotalInterest + 22_500m, result.Refinanced.TotalCost);
    }

    [Fact]
    public void Refinance_HigherRate_CostsMore()
    {
        var result = RefinanceCalculator.Compare(Existing(), new RefinanceInput(12m, 72, 0m, false));
        Assert.True(result.LifetimeSavings < 0m);
        Assert.Null(result.BreakEvenMonth);
    }

    [Fact]
    public void Refinance_InvalidInput_Throws()
    {
        var ex = Assert.Throws<LoanValidationException>(() => RefinanceCalculator.Compare(Existing(), new RefinanceInput(-1m, 0, -5m, false)));
        Assert.Equal(["newAprPercent", "newTermMonths", "fees"], ex.Errors.Select(e => e.Field));
    }

    [Fact]
    public void Insights_AreComputedFromTheLoan()
    {
        var analysis = Existing(vehicleValue: 25_000m);
        var insights = InsightsEngine.Generate(analysis);
        var byId = insights.ToDictionary(i => i.Id);

        Assert.Equal(analysis.Status.PercentRepaid, byId["progress"].Metric!.Value);
        Assert.Contains("26.7%", byId["progress"].Message); // (30,000 − 22,000) ÷ 30,000

        var payment = analysis.Status.ScheduledPayment;
        var extra = InsightsEngine.SuggestedExtra(payment);
        var expected = Simulator.Compare(analysis.Baseline,
            analysis.Project(new Scenario { RecurringExtras = [new RecurringExtra(extra)] }));
        var extraInsight = byId[$"extra-{extra:0}"];
        Assert.Equal(expected.InterestSaved, extraInsight.Metric!.Value);
        Assert.Contains($"{expected.MonthsSaved} months earlier", extraInsight.Message);

        var lump = ScenarioComparer.SuggestedLumpSum(22_000m);
        Assert.True(byId.ContainsKey($"lump-{lump:0}"));
        Assert.True(byId.ContainsKey("rate-sensitivity"));
        Assert.True(byId.ContainsKey("equity"));
        Assert.All(insights, i => Assert.False(string.IsNullOrWhiteSpace(i.Explanation)));
    }

    [Fact]
    public void Insights_DifferentLoans_GiveDifferentNumbers()
    {
        var a = InsightsEngine.Generate(Existing(apr: 4m)).Single(i => i.Id.StartsWith("extra-", StringComparison.Ordinal) && !i.Id.Contains("percent"));
        var b = InsightsEngine.Generate(Existing(apr: 12m)).Single(i => i.Id.StartsWith("extra-", StringComparison.Ordinal) && !i.Id.Contains("percent"));
        Assert.NotEqual(a.Metric!.Value, b.Metric!.Value);
    }

    [Fact]
    public void Insights_InsufficientPayment_RaisesWarning()
    {
        var loan = TestLoans.Standard(20_000m, 12m, 60);
        loan.ScheduledPayment = 150m;
        var insights = InsightsEngine.Generate(LoanAnalyzer.Analyze(loan, TestLoans.Today));
        Assert.Contains(insights, i => i is { Id: "warning:insufficient-payment", Tone: InsightTone.Warning });
        Assert.DoesNotContain(insights, i => i.Category == InsightCategory.Savings);
    }

    [Fact]
    public void Insights_BestSavedScenario_IsNamed()
    {
        var analysis = Existing();
        var saved = new List<Scenario>
        {
            new() { Id = 4, Name = "Tax refund", LumpSums = [new LumpSum(3000m, new DateOnly(2027, 4, 15))] },
            new() { Id = 5, Name = "Small", RecurringExtras = [new RecurringExtra(10m)] },
        };
        var insight = InsightsEngine.Generate(analysis, saved).Single(i => i.Category == InsightCategory.Scenario);
        Assert.Contains("Tax refund", insight.Message);
    }

    [Fact]
    public void Csv_ParsesHeaderQuotesAndFormatsAndReportsErrors()
    {
        const string csv = """
            date,amount,principal,interest,note
            2024-02-01,"$1,483.32",1358.32,125.00,"First, extra"
            03/01/2024,483.32,,,
            not-a-date,10
            2024-04-01,-5
            2024-05-01,100,60,30
            """;
        var import = PaymentHistory.ParseCsv(csv, 9);

        Assert.Equal(2, import.Records.Count);
        Assert.Equal(1483.32m, import.Records[0].Amount);
        Assert.Equal(125m, import.Records[0].Interest);
        Assert.Equal("First, extra", import.Records[0].Note);
        Assert.Equal(new DateOnly(2024, 3, 1), import.Records[1].Date);
        Assert.Null(import.Records[1].Principal);
        Assert.Equal([4, 5, 6], import.Errors.Select(e => e.Line));
    }

    [Fact]
    public void Tracking_ComparesCumulativeAmounts()
    {
        var loan = TestLoans.Standard();
        var analysis = LoanAnalyzer.Analyze(loan, new DateOnly(2024, 4, 15));
        var records = new List<PaymentRecord>
        {
            new() { Date = new DateOnly(2024, 2, 1), Amount = 483.32m },
            new() { Date = new DateOnly(2024, 3, 1), Amount = 600m },
        };
        var result = PaymentHistory.Track(analysis, records);

        Assert.Equal(3, result.Points.Count);
        Assert.Equal(483.32m * 3, result.TotalScheduled);
        Assert.Equal(1083.32m, result.TotalActual);
        Assert.Equal(1083.32m, result.Points[^1].ActualCumulative);
        Assert.Equal(1083.32m - (483.32m * 3), result.Difference);
    }

    [Fact]
    public void AnnualSummary_GroupsByYear()
    {
        var projection = AmortizationEngine.Run(TestLoans.Request(TestLoans.Standard()));
        var annual = ScheduleSummaries.Annual(projection.Rows);
        Assert.Equal([2024, 2025, 2026, 2027, 2028, 2029], annual.Select(a => a.Year));
        Assert.Equal(11, annual[0].Payments);
        Assert.Equal(projection.Summary.TotalInterest, annual.Sum(a => a.Interest));
        Assert.Equal(0m, annual[^1].EndingBalance);
    }
}
