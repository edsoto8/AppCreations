namespace StepRecorder.Core.Input;

/// <summary>
/// Decides whether a click repeats the previous one (part of a double- or triple-click): same button,
/// same window, almost the same spot, and soon after. Each click is compared with the one just before
/// it, so a triple-click chains.
/// </summary>
public static class RepeatClickDetector
{
    /// <summary>Windows' default double-click time.</summary>
    public static readonly TimeSpan MaxInterval = TimeSpan.FromMilliseconds(500);

    /// <summary>
    /// Physical pixels. Windows' default double-click box is 4×4 at 96 DPI; this leaves room for higher
    /// DPI and shaky hands without merging deliberate separate clicks.
    /// </summary>
    public const int MaxDistance = 6;

    public static bool IsRepeat(MouseClick previous, long? previousWindow, MouseClick current, long? currentWindow)
    {
        TimeSpan interval = current.Timestamp - previous.Timestamp;
        return current.Button == previous.Button
            && currentWindow == previousWindow
            && interval >= TimeSpan.Zero
            && interval <= MaxInterval
            && Math.Abs(current.X - previous.X) <= MaxDistance
            && Math.Abs(current.Y - previous.Y) <= MaxDistance;
    }
}
