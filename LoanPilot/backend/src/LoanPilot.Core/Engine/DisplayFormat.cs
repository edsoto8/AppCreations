using System.Globalization;

namespace LoanPilot.Core.Engine;

/// <summary>
/// Formats amounts and dates inside generated text (warnings, insights). Numbers use US-style
/// grouping; only the currency symbol follows the user's preference.
/// </summary>
public sealed record DisplayFormat(string CurrencySymbol)
{
    public static readonly DisplayFormat Default = new("$");

    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-US");

    public static DisplayFormat ForCurrency(string? isoCode) => (isoCode ?? "USD").ToUpperInvariant() switch
    {
        "EUR" => new DisplayFormat("€"),
        "GBP" => new DisplayFormat("£"),
        "USD" or "CAD" or "AUD" or "MXN" => Default,
        _ => Default,
    };

    /// <summary>"$1,234.56"; negative amounts as "-$1,234.56".</summary>
    public string Money(decimal amount) =>
        (amount < 0 ? "-" : "") + CurrencySymbol + Math.Abs(amount).ToString("N2", Culture);

    /// <summary>Whole-currency amount for round figures in prose: "$2,000".</summary>
    public string WholeMoney(decimal amount) =>
        (amount < 0 ? "-" : "") + CurrencySymbol + Math.Abs(Math.Round(amount, 0, MidpointRounding.AwayFromZero)).ToString("N0", Culture);

    public string MonthYear(DateOnly date) => date.ToString("MMMM yyyy", Culture);

    public string LongDate(DateOnly date) => date.ToString("MMMM d, yyyy", Culture);

    public static string Percent(decimal value, int decimals = 1) =>
        Math.Round(value, decimals, MidpointRounding.AwayFromZero).ToString("0." + new string('#', decimals), Culture) + "%";

    public static string Rate(decimal aprPercent) => aprPercent.ToString("0.###", Culture) + "%";

    public static string Months(int months)
    {
        if (months == 1)
        {
            return "1 month";
        }

        return months.ToString(Culture) + " months";
    }

    public static string Count(int value) => value.ToString("N0", Culture);
}
