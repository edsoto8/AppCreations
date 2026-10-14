using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

/// <summary>Interest calculations for both accrual conventions. Results are unrounded.</summary>
public static class InterestAccrual
{
    /// <summary>Periodic interest for one payment period: balance × APR ÷ periods per year.</summary>
    public static decimal Periodic(decimal balance, decimal aprPercent, PaymentFrequency frequency) =>
        balance * PaymentMath.PeriodicRate(aprPercent, frequency);

    /// <summary>
    /// Daily simple interest on <paramref name="balance"/> for the days in [<paramref name="from"/>,
    /// <paramref name="to"/>): balance × APR × days ÷ 365 (Actual/365), or with each day weighted
    /// 1/365 or 1/366 by its calendar year (Actual/Actual).
    /// </summary>
    public static decimal Daily(decimal balance, decimal aprPercent, DateOnly from, DateOnly to, DayCountBasis basis)
    {
        if (to <= from || balance == 0m || aprPercent == 0m)
        {
            return 0m;
        }

        var rate = aprPercent / 100m;
        if (basis == DayCountBasis.Actual365)
        {
            return balance * rate * (to.DayNumber - from.DayNumber) / 365m;
        }

        var total = 0m;
        var cursor = from;
        while (cursor < to)
        {
            var yearEnd = new DateOnly(cursor.Year + 1, 1, 1);
            var segmentEnd = yearEnd < to ? yearEnd : to;
            var daysInYear = DateTime.IsLeapYear(cursor.Year) ? 366m : 365m;
            total += balance * rate * (segmentEnd.DayNumber - cursor.DayNumber) / daysInYear;
            cursor = segmentEnd;
        }

        return total;
    }

    /// <summary>Interest per day at the current balance (Actual/365), for "costs about $X a day" displays.</summary>
    public static decimal PerDay(decimal balance, decimal aprPercent) => balance * aprPercent / 100m / 365m;
}
