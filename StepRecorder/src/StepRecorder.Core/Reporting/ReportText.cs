using System.Globalization;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Reporting;

/// <summary>Formatting shared by every exporter. Invariant and unambiguous, so reports read the same everywhere.</summary>
public static class ReportText
{
    public static string DateTime(DateTimeOffset value) =>
        value.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    public static string Time(DateTimeOffset value) =>
        value.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    public static string Duration(TimeSpan? value) => value is not { } duration
        ? "—"
        : duration.TotalHours >= 1
            ? duration.ToString(@"h\:mm\:ss", CultureInfo.InvariantCulture)
            : duration.ToString(@"m\:ss", CultureInfo.InvariantCulture);

    public static string Steps(int count) => count == 1 ? "1 step" : $"{count} steps";

    public static string Status(SessionStatus status) => status switch
    {
        SessionStatus.Completed => "Completed",
        _ => "Incomplete (the recording was interrupted)",
    };

    /// <summary>Percent-encodes each segment of a relative path for use in a link or image source.</summary>
    public static string UrlPath(string relativePath) =>
        string.Join('/', relativePath.Split('/').Select(Uri.EscapeDataString));
}
