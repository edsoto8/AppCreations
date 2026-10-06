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

/// <param name="RelativePath">The original screenshot, relative to the session folder, with forward slashes.</param>
/// <param name="MarkedRelativePath">A copy with the click marker drawn in, when one was made.</param>
public sealed record ReportScreenshot(
    string RelativePath,
    int Width,
    int Height,
    ClickMarker? Marker,
    string? MarkedRelativePath = null);

/// <summary>A ring centred on the click, in screenshot pixels.</summary>
public readonly record struct ClickMarker(int X, int Y, int Diameter, int StrokeWidth)
{
    /// <summary>Radius of the stroke's centre line, so the ring's outer edge is <see cref="Diameter"/> wide.</summary>
    public double Radius => (Diameter - StrokeWidth) / 2.0;
}
