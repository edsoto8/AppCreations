using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

/// <summary>
/// Payment due dates. Monthly dates keep the first payment's day of month and clamp to the last day of
/// shorter months (Jan 31 → Feb 28/29 → Mar 31): each date is computed from the anchor, never chained,
/// so one short month never shifts later dates. Biweekly and weekly dates step 14 or 7 days.
/// </summary>
public static class PaymentCalendar
{
    /// <summary>Due date of the payment at zero-based <paramref name="index"/> (index 0 is the first payment).</summary>
    public static DateOnly DueDate(DateOnly firstPayment, PaymentFrequency frequency, int index)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(index);
        return frequency switch
        {
            PaymentFrequency.Monthly => firstPayment.AddMonths(index),
            PaymentFrequency.Biweekly => firstPayment.AddDays(14 * index),
            PaymentFrequency.Weekly => firstPayment.AddDays(7 * index),
            _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, null),
        };
    }

    /// <summary>Zero-based index of the first payment due strictly after <paramref name="date"/>.</summary>
    public static int FirstIndexAfter(DateOnly firstPayment, PaymentFrequency frequency, DateOnly date)
    {
        if (date < firstPayment)
        {
            return 0;
        }

        // Estimate, then correct; monthly clamping makes a closed form awkward.
        var estimate = frequency switch
        {
            PaymentFrequency.Monthly => ((date.Year - firstPayment.Year) * 12) + date.Month - firstPayment.Month,
            PaymentFrequency.Biweekly => (date.DayNumber - firstPayment.DayNumber) / 14,
            _ => (date.DayNumber - firstPayment.DayNumber) / 7,
        };
        var index = Math.Max(0, estimate - 1);
        while (DueDate(firstPayment, frequency, index) <= date)
        {
            index++;
        }

        while (index > 0 && DueDate(firstPayment, frequency, index - 1) > date)
        {
            index--;
        }

        return index;
    }

    /// <summary>Number of payments due on or before <paramref name="date"/>.</summary>
    public static int CountDueOnOrBefore(DateOnly firstPayment, PaymentFrequency frequency, DateOnly date) =>
        FirstIndexAfter(firstPayment, frequency, date);

    /// <summary>Whole calendar months from <paramref name="from"/> to <paramref name="to"/>, ignoring the day of month.</summary>
    public static int MonthsBetween(DateOnly from, DateOnly to) =>
        ((to.Year - from.Year) * 12) + to.Month - from.Month;
}
