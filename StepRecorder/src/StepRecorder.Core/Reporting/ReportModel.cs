using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Reporting;

/// <summary>
/// Everything a report shows, in display form and independent of output format. Every exporter
/// renders this same model, so HTML and Markdown always agree.
/// </summary>
public sealed record ReportModel(
    string Title,
    SessionStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    TimeSpan? Duration,
    TimeSpan? ActiveDuration,
    string ApplicationVersion,
    string OperatingSystem,
    IReadOnlyList<ReportStep> Steps);

public sealed record ReportStep(
    int Number,
    DateTimeOffset Timestamp,
    string ApplicationName,
    string? WindowTitle,
    string Description,
    ReportScreenshot? Screenshot,
    string? ScreenshotNote)
{
    /// <summary>For example "Step 7 — Visual Studio".</summary>
    public string Heading => $"Step {Number} — {ApplicationName}";
}

/// <param name="RelativePath">Relative to the session folder, with forward slashes.</param>
public sealed record ReportScreenshot(string RelativePath, int Width, int Height, ClickMarker? Marker);

/// <summary>Where the click was on the screenshot, in image pixels and as a percentage of its size.</summary>
public readonly record struct ClickMarker(int X, int Y, double LeftPercent, double TopPercent);
