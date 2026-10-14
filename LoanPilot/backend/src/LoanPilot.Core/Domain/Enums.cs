namespace LoanPilot.Core.Domain;

/// <summary>How often the regular payment is due.</summary>
public enum PaymentFrequency
{
    Monthly = 0,
    Biweekly = 1,
    Weekly = 2,
}

/// <summary>
/// How interest accrues between payments. The entered APR is always a nominal annual rate.
/// </summary>
public enum AccrualMethod
{
    /// <summary>
    /// Periodic (amortization-table) interest: each period charges balance × APR ÷ periods-per-year,
    /// regardless of how many calendar days the period has.
    /// </summary>
    Monthly = 0,

    /// <summary>
    /// Daily simple interest: interest accrues every calendar day on the outstanding principal
    /// (balance × APR ÷ day-count basis × days) and is paid when a payment posts. Interest is never
    /// compounded: unpaid interest is carried separately, not added to principal.
    /// </summary>
    DailySimple = 1,
}

/// <summary>Day-count convention used by <see cref="AccrualMethod.DailySimple"/>.</summary>
public enum DayCountBasis
{
    /// <summary>Every day is 1/365 of a year, including in leap years (most US auto lenders).</summary>
    Actual365 = 0,

    /// <summary>Each day is 1/365 or 1/366 of a year depending on whether its calendar year is a leap year.</summary>
    ActualActual = 1,
}

public static class PaymentFrequencyExtensions
{
    public static int PeriodsPerYear(this PaymentFrequency frequency) => frequency switch
    {
        PaymentFrequency.Monthly => 12,
        PaymentFrequency.Biweekly => 26,
        PaymentFrequency.Weekly => 52,
        _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, null),
    };

    /// <summary>Number of payments a term of <paramref name="termMonths"/> months contains at this frequency.</summary>
    public static int PaymentsForTerm(this PaymentFrequency frequency, int termMonths) => frequency switch
    {
        PaymentFrequency.Monthly => termMonths,
        _ => (int)Math.Round(termMonths * frequency.PeriodsPerYear() / 12m, MidpointRounding.AwayFromZero),
    };
}
