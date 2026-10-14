using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class ValidationTests
{
    private static IReadOnlyList<string> Fields(Loan loan) =>
        LoanValidator.Validate(loan, TestLoans.Today).Select(e => e.Field).ToList();

    [Fact]
    public void ValidLoan_HasNoErrors() => Assert.Empty(Fields(TestLoans.Standard()));

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(20_000_000)]
    public void OriginalAmount_OutOfRange(decimal amount) => Assert.Contains("originalAmount", Fields(TestLoans.Standard(amount)));

    [Theory]
    [InlineData(-0.5)]
    [InlineData(150)]
    public void Apr_OutOfRange(decimal apr) => Assert.Contains("aprPercent", Fields(TestLoans.Standard(apr: apr)));

    [Theory]
    [InlineData(0)]
    [InlineData(241)]
    public void Term_OutOfRange(int term) => Assert.Contains("termMonths", Fields(TestLoans.Standard(term: term)));

    [Fact]
    public void FirstPaymentNotAfterStart_IsRejected() =>
        Assert.Contains("firstPaymentDate", Fields(TestLoans.Standard(start: new DateOnly(2024, 2, 1), firstPayment: new DateOnly(2024, 2, 1))));

    [Fact]
    public void BalanceWithoutDate_AndDateWithoutBalance_AreRejected()
    {
        var a = TestLoans.Standard();
        a.CurrentBalance = 1000m;
        Assert.Contains("balanceAsOf", Fields(a));

        var b = TestLoans.Standard();
        b.BalanceAsOf = new DateOnly(2026, 1, 1);
        Assert.Contains("currentBalance", Fields(b));
    }

    [Fact]
    public void BalanceDateInFutureOrBeforeStart_IsRejected()
    {
        var future = TestLoans.Standard();
        future.CurrentBalance = 1000m;
        future.BalanceAsOf = TestLoans.Today.AddDays(1);
        Assert.Contains("balanceAsOf", Fields(future));

        var early = TestLoans.Standard();
        early.CurrentBalance = 1000m;
        early.BalanceAsOf = new DateOnly(2023, 12, 1);
        Assert.Contains("balanceAsOf", Fields(early));
    }

    [Fact]
    public void NegativeOptionalAmounts_AreRejected()
    {
        var loan = TestLoans.Standard();
        loan.DownPayment = -1m;
        loan.ScheduledPayment = 0m;
        loan.InterestPaidToDate = -5m;
        loan.VehicleValue = -1m;
        loan.CurrentBalance = -1m;
        loan.BalanceAsOf = new DateOnly(2026, 1, 1);
        Assert.Equal(["downPayment", "scheduledPayment", "currentBalance", "interestPaidToDate", "vehicleValue"],
            Fields(loan));
    }

    [Fact]
    public void MissingName_IsRejected()
    {
        var loan = TestLoans.Standard();
        loan.Name = "  ";
        Assert.Contains("name", Fields(loan));
    }

    [Fact]
    public void Scenario_LumpSumBeforeProjectionStart_IsRejected()
    {
        var analysis = LoanAnalyzer.Analyze(TestLoans.Standard(), TestLoans.Today);
        var scenario = new Scenario
        {
            LumpSums = [new LumpSum(500m, new DateOnly(2025, 1, 1)), new LumpSum(0m, TestLoans.Today)],
            RecurringExtras = [new RecurringExtra(-5m), new RecurringExtra(10m, new DateOnly(2027, 1, 1), new DateOnly(2026, 1, 1))],
            BudgetPayment = 100m,
        };
        var fields = ScenarioValidator.Validate(scenario, analysis, requireName: true).Select(e => e.Field).ToList();

        Assert.Equal(["name", "budgetPayment", "recurringExtras[0].amount", "recurringExtras[1].endDate", "lumpSums[0].date", "lumpSums[1].amount"],
            fields);
    }
}
