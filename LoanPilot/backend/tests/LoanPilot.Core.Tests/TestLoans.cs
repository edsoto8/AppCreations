using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

internal static class TestLoans
{
    public static readonly DateOnly Today = new(2026, 10, 14);

    public static Loan Standard(decimal amount = 25_000m, decimal apr = 6m, int term = 60,
        DateOnly? start = null, DateOnly? firstPayment = null) => new()
    {
        Name = "Test car",
        OriginalAmount = amount,
        AprPercent = apr,
        TermMonths = term,
        StartDate = start ?? new DateOnly(2024, 1, 1),
        FirstPaymentDate = firstPayment ?? new DateOnly(2024, 2, 1),
    };

    public static AmortizationRequest Request(Loan loan, decimal? payment = null) => new()
    {
        StartingBalance = loan.OriginalAmount,
        StartDate = loan.StartDate,
        FirstPaymentDate = loan.FirstPaymentDate,
        FirstPaymentIndex = 0,
        ScheduledPayment = payment ?? PaymentMath.StandardPayment(loan.OriginalAmount, loan.AprPercent, loan.PaymentFrequency,
            loan.PaymentFrequency.PaymentsForTerm(loan.TermMonths)),
        AprPercent = loan.AprPercent,
        Frequency = loan.PaymentFrequency,
        AccrualMethod = loan.AccrualMethod,
        DayCountBasis = loan.DayCountBasis,
        ContractPaymentCount = loan.PaymentFrequency.PaymentsForTerm(loan.TermMonths),
    };

    /// <summary>Invariants every projection must satisfy.</summary>
    public static void AssertConsistent(Projection projection)
    {
        decimal? previousEnding = null;
        foreach (var row in projection.Rows)
        {
            Assert.True(row.EndingBalance >= 0m, $"negative balance on {row.Date}");
            Assert.True(row.Principal >= 0m, $"negative principal on {row.Date}");
            Assert.Equal(row.StartingBalance - row.Principal, row.EndingBalance);
            Assert.Equal(row.ScheduledPayment + row.ExtraPayment, row.TotalPayment);
            Assert.Equal(decimal.Round(row.Interest, 2), row.Interest);
            if (previousEnding is { } prev)
            {
                Assert.Equal(prev, row.StartingBalance);
            }

            previousEnding = row.EndingBalance;
        }

        Assert.Equal(projection.Rows.Sum(r => r.TotalPayment), projection.Summary.TotalPaid);
        Assert.Equal(projection.Rows.Sum(r => r.Interest), projection.Summary.TotalInterest);
        if (projection.Summary.PaysOff && projection.Rows.Count > 0)
        {
            Assert.Equal(0m, projection.Rows[^1].EndingBalance);
            Assert.Equal(0m, projection.Rows[^1].UnpaidInterest);
        }
    }
}
