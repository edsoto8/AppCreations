using System.Reflection;
using LoanPilot.Core.Domain;

namespace LoanPilot.Data.Tests.Support;

internal static class Samples
{
    public static Loan MinimalLoan(string name = "Civic") => new()
    {
        Name = name,
        OriginalAmount = 25000m,
        AprPercent = 6.49m,
        TermMonths = 60,
        StartDate = new DateOnly(2025, 1, 15),
        FirstPaymentDate = new DateOnly(2025, 2, 15),
    };

    /// <summary>Every optional property set to a distinctive value, so a column that is not mapped shows up.</summary>
    public static Loan FullLoan(string name = "Tacoma") => new()
    {
        Name = name,
        VehicleMake = "Toyota",
        VehicleModel = "Tacoma TRD",
        VehicleYear = 2024,
        Lender = "Credit Union of Examples",
        OriginalAmount = 38765.4321m,
        DownPayment = 4000.05m,
        AprPercent = 5.875m,
        TermMonths = 72,
        StartDate = new DateOnly(2024, 2, 29),
        FirstPaymentDate = new DateOnly(2024, 4, 1),
        ScheduledPayment = 612.3456m,
        PaymentFrequency = PaymentFrequency.Biweekly,
        AccrualMethod = AccrualMethod.DailySimple,
        DayCountBasis = DayCountBasis.ActualActual,
        CurrentBalance = 31234.5678m,
        BalanceAsOf = new DateOnly(2026, 2, 1),
        PaymentsMade = 21,
        InterestPaidToDate = 3210.09m,
        VehicleValue = 29999.99m,
        Notes = "Quote \"A\"; semi'colon -- and unicode: éü 中",
    };

    /// <summary>Asserts every public property matches, so a newly added Loan property is covered automatically.</summary>
    public static void AssertSameLoan(Loan expected, Loan? actual)
    {
        Assert.NotNull(actual);
        foreach (var property in typeof(Loan).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            Assert.True(
                Equals(property.GetValue(expected), property.GetValue(actual)),
                $"Loan.{property.Name}: expected '{property.GetValue(expected)}' but was '{property.GetValue(actual)}'");
        }
    }

    public static Scenario RichScenario(long loanId, string name = "Extra $100") => new()
    {
        LoanId = loanId,
        Name = name,
        Description = "Pay more, earlier",
        BudgetPayment = 750.5m,
        RecurringExtras =
        [
            new RecurringExtra(100m),
            new RecurringExtra(50.25m, new DateOnly(2026, 1, 1)),
            new RecurringExtra(75m, new DateOnly(2026, 6, 1), new DateOnly(2027, 5, 31)),
        ],
        LumpSums =
        [
            new LumpSum(2000m, new DateOnly(2027, 4, 15), "Tax refund"),
            new LumpSum(500.55m, new DateOnly(2026, 12, 24)),
            new LumpSum(1m, new DateOnly(2026, 12, 25), "Bonus"),
        ],
    };

    public static PaymentRecord Payment(long loanId, DateOnly date, decimal amount = 500m, string? note = null) => new()
    {
        LoanId = loanId,
        Date = date,
        Amount = amount,
        Note = note,
    };
}
