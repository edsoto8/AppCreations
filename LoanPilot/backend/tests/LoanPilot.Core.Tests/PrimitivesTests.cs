using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

public sealed class PrimitivesTests
{
    [Theory]
    [InlineData(25000, 6, 60, 483.32)]
    [InlineData(30000, 4.9, 72, 481.76)]
    [InlineData(10000, 0, 36, 277.78)]
    [InlineData(1000, 100, 12, 135.00)]
    public void StandardPayment_MatchesFormula(decimal principal, decimal apr, int n, decimal expected) =>
        Assert.Equal(expected, PaymentMath.StandardPayment(principal, apr, PaymentFrequency.Monthly, n));

    [Fact]
    public void Round_IsHalfAwayFromZero()
    {
        Assert.Equal(0.13m, Money.Round(0.125m));
        Assert.Equal(-0.13m, Money.Round(-0.125m));
        Assert.Equal(2.34m, Money.Round(2.344999m));
    }

    [Fact]
    public void Pow_IsExactForIntegers() => Assert.Equal(1.21m, Money.Pow(1.1m, 2));

    [Fact]
    public void DueDate_MonthlyFromMonthEnd_ClampsWithoutDrift()
    {
        var first = new DateOnly(2023, 1, 31);
        Assert.Equal(new DateOnly(2023, 2, 28), PaymentCalendar.DueDate(first, PaymentFrequency.Monthly, 1));
        Assert.Equal(new DateOnly(2023, 3, 31), PaymentCalendar.DueDate(first, PaymentFrequency.Monthly, 2));
        Assert.Equal(new DateOnly(2024, 2, 29), PaymentCalendar.DueDate(first, PaymentFrequency.Monthly, 13));
    }

    [Fact]
    public void DueDate_Feb29Anchor_FallsBackToFeb28InCommonYears()
    {
        var first = new DateOnly(2024, 2, 29);
        Assert.Equal(new DateOnly(2025, 2, 28), PaymentCalendar.DueDate(first, PaymentFrequency.Monthly, 12));
        Assert.Equal(new DateOnly(2028, 2, 29), PaymentCalendar.DueDate(first, PaymentFrequency.Monthly, 48));
    }

    [Theory]
    [InlineData("2024-01-31", "2024-01-30", 0)]
    [InlineData("2024-01-31", "2024-01-31", 1)]
    [InlineData("2024-01-31", "2024-02-28", 1)]
    [InlineData("2024-01-31", "2024-02-29", 2)]
    [InlineData("2024-01-31", "2026-10-14", 33)]
    public void FirstIndexAfter_CountsPaymentsDueOnOrBefore(string first, string date, int expected) =>
        Assert.Equal(expected, PaymentCalendar.FirstIndexAfter(DateOnly.Parse(first), PaymentFrequency.Monthly, DateOnly.Parse(date)));

    [Fact]
    public void FirstIndexAfter_Weekly() =>
        Assert.Equal(3, PaymentCalendar.FirstIndexAfter(new DateOnly(2024, 1, 1), PaymentFrequency.Weekly, new DateOnly(2024, 1, 15)));

    [Fact]
    public void DailyInterest_ActualActual_SplitsAtYearBoundary()
    {
        // Dec 17 2023 → Jan 16 2024: 15 days at /365 and 15 days at /366.
        var interest = InterestAccrual.Daily(10_000m, 6m, new DateOnly(2023, 12, 17), new DateOnly(2024, 1, 16), DayCountBasis.ActualActual);
        Assert.Equal(Money.Round((10_000m * 0.06m * 15m / 365m) + (10_000m * 0.06m * 15m / 366m)), Money.Round(interest));

        var fixed365 = InterestAccrual.Daily(10_000m, 6m, new DateOnly(2023, 12, 17), new DateOnly(2024, 1, 16), DayCountBasis.Actual365);
        Assert.Equal(Money.Round(10_000m * 0.06m * 30m / 365m), Money.Round(fixed365));
    }

    [Fact]
    public void DailyInterest_FullLeapYear_Actual365ChargesExtraDay()
    {
        var start = new DateOnly(2024, 1, 1);
        var end = new DateOnly(2025, 1, 1);
        Assert.Equal(600m, Money.Round(InterestAccrual.Daily(10_000m, 6m, start, end, DayCountBasis.ActualActual)));
        Assert.Equal(601.64m, Money.Round(InterestAccrual.Daily(10_000m, 6m, start, end, DayCountBasis.Actual365)));
    }

    [Theory]
    [InlineData(PaymentFrequency.Monthly, 60, 60)]
    [InlineData(PaymentFrequency.Biweekly, 60, 130)]
    [InlineData(PaymentFrequency.Weekly, 36, 156)]
    public void PaymentsForTerm_ConvertsMonths(PaymentFrequency frequency, int months, int expected) =>
        Assert.Equal(expected, frequency.PaymentsForTerm(months));
}
