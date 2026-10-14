using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public static class PaymentMath
{
    /// <summary>
    /// Standard level payment that amortizes <paramref name="principal"/> over
    /// <paramref name="payments"/> periods: P = L·i / (1 − (1 + i)^−n) with i = APR ÷ periods per year,
    /// or L ÷ n for a zero-rate loan. Rounded to the nearest cent; the final payment absorbs the difference.
    /// </summary>
    public static decimal StandardPayment(decimal principal, decimal aprPercent, PaymentFrequency frequency, int payments)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(payments);
        if (principal <= 0m)
        {
            return 0m;
        }

        if (aprPercent == 0m)
        {
            return Money.Round(principal / payments);
        }

        var i = PeriodicRate(aprPercent, frequency);
        var growth = Money.Pow(1m + i, payments);
        var exact = principal * i * growth / (growth - 1m);
        var rounded = Money.Round(exact);

        // Rounding down can leave a payment that only just covers the interest (high APR, long term) or a
        // residual after the last payment larger than one payment. Round up to the cent in those cases.
        var residual = (principal * growth) - (rounded * (growth - 1m) / i);
        return rounded <= principal * i || residual > rounded ? Money.RoundUp(exact) : rounded;
    }

    /// <summary>Nominal periodic rate: APR (percent) ÷ 100 ÷ periods per year.</summary>
    public static decimal PeriodicRate(decimal aprPercent, PaymentFrequency frequency) =>
        aprPercent / 100m / frequency.PeriodsPerYear();
}
