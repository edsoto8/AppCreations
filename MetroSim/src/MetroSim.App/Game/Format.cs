using System.Globalization;
using MetroSim.Core.Engine;

namespace MetroSim.App.Game;

/// <summary>Display formatting. The simulation keeps money in cents; the UI shows whole dollars.</summary>
public static class Format
{
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    public static string Money(long cents)
    {
        long dollars = cents / 100;
        return dollars < 0
            ? "-$" + (-dollars).ToString("N0", Culture)
            : "$" + dollars.ToString("N0", Culture);
    }

    /// <summary>Money with an explicit sign, for daily net and ledger deltas.</summary>
    public static string SignedMoney(long cents) => cents > 0 ? "+" + Money(cents) : Money(cents);

    public static string Number(long value) => value.ToString("N0", Culture);

    public static string Clock(int minuteOfDay) =>
        $"{minuteOfDay / 60:00}:{minuteOfDay % 60:00}";

    /// <summary>"Day 3 · 07:45" from a tick count (days shown 1-based).</summary>
    public static string Date(long tick) =>
        $"Day {tick / Simulation.TicksPerDay + 1} · {Clock((int)(tick % Simulation.TicksPerDay))}";

    public static string Bytes(long bytes) => bytes switch
    {
        >= 1L << 30 => (bytes / (double)(1L << 30)).ToString("0.00", Culture) + " GB",
        >= 1L << 20 => (bytes / (double)(1L << 20)).ToString("0.0", Culture) + " MB",
        >= 1L << 10 => (bytes / (double)(1L << 10)).ToString("0", Culture) + " KB",
        _ => bytes.ToString(Culture) + " B",
    };

    public static string Fixed(double value, int decimals) =>
        value.ToString("F" + decimals.ToString(Culture), Culture);
}
