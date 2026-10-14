namespace LoanPilot.Core.Engine;

/// <summary>
/// Rounding and decimal helpers. Every posted amount (interest, payment, balance) is rounded to cents
/// with <see cref="MidpointRounding.AwayFromZero"/>, the convention lenders use for statements.
/// Intermediate accruals stay unrounded until they post.
/// </summary>
public static class Money
{
    public static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);

    /// <summary>Rounds up to the next cent (used when a payment must be "at least" a value).</summary>
    public static decimal RoundUp(decimal amount) => Math.Ceiling(amount * 100m) / 100m;

    public static decimal Percent(decimal part, decimal whole) =>
        whole == 0m ? 0m : Math.Round(part / whole * 100m, 2, MidpointRounding.AwayFromZero);

    /// <summary>Exact integer power by repeated squaring (decimal has no Math.Pow).</summary>
    public static decimal Pow(decimal value, int exponent)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(exponent);
        var result = 1m;
        var factor = value;
        var e = exponent;
        while (e > 0)
        {
            if ((e & 1) == 1)
            {
                result *= factor;
            }

            e >>= 1;
            if (e > 0)
            {
                factor *= factor;
            }
        }

        return result;
    }
}
