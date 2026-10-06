using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Reporting;

public static class ReportBuilder
{
    public static ReportModel Build(Session session) => new(
        Title: string.IsNullOrWhiteSpace(session.Name) ? "Recording" : session.Name.Trim(),
        Status: session.Status,
        StartedAt: session.StartedAt,
        EndedAt: session.EndedAt,
        Duration: session.Duration,
        ActiveDuration: session.ActiveDuration,
        ApplicationVersion: session.ApplicationVersion,
        OperatingSystem: session.OperatingSystem,
        Steps: session.Steps.OrderBy(s => s.StepNumber).Select(BuildStep).ToList());

    private static ReportStep BuildStep(Step step)
    {
        ReportScreenshot? screenshot = null;
        if (step.ScreenshotStatus == ScreenshotStatus.Captured
            && !string.IsNullOrEmpty(step.ScreenshotPath)
            && step.ScreenshotWidth is > 0 and int width
            && step.ScreenshotHeight is > 0 and int height)
        {
            screenshot = new ReportScreenshot(step.ScreenshotPath, width, height, Marker(step, width, height));
        }

        return new ReportStep(
            Number: step.StepNumber,
            Timestamp: step.Timestamp,
            ApplicationName: StepDescriber.ApplicationName(step),
            WindowTitle: string.IsNullOrWhiteSpace(step.WindowTitle) ? null : step.WindowTitle.Trim(),
            Description: StepDescriber.Describe(step),
            Screenshot: screenshot,
            ScreenshotNote: step.ScreenshotNote);
    }

    /// <summary>
    /// The click relative to the window is also relative to the screenshot, because both start at the
    /// window frame's top-left in physical pixels (docs/decisions/0004). A click outside the image (for
    /// example on the invisible resize border) gets no marker.
    /// </summary>
    private static ClickMarker? Marker(Step step, int width, int height)
    {
        if (step.ClickXRelativeToWindow is not { } x || step.ClickYRelativeToWindow is not { } y)
        {
            return null;
        }

        if (x < 0 || y < 0 || x >= width || y >= height)
        {
            return null;
        }

        return new ClickMarker(x, y, Math.Round(100.0 * x / width, 3), Math.Round(100.0 * y / height, 3));
    }
}
