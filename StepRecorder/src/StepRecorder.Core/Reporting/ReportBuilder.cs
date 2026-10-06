using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Reporting;

public static class ReportBuilder
{
    public static ReportModel Build(Session session, ScreenshotSettings? markerSettings = null) => new(
        Title: string.IsNullOrWhiteSpace(session.Name) ? "Recording" : session.Name.Trim(),
        Status: session.Status,
        StartedAt: session.StartedAt,
        EndedAt: session.EndedAt,
        Duration: session.Duration,
        ActiveDuration: session.ActiveDuration,
        ApplicationVersion: session.ApplicationVersion,
        OperatingSystem: session.OperatingSystem,
        Steps: session.Steps
            .OrderBy(s => s.StepNumber)
            .Select(s => BuildStep(s, markerSettings ?? new ScreenshotSettings()))
            .ToList());

    private static ReportStep BuildStep(Step step, ScreenshotSettings markerSettings)
    {
        ReportScreenshot? screenshot = null;
        if (step.ScreenshotStatus == ScreenshotStatus.Captured
            && !string.IsNullOrEmpty(step.ScreenshotPath)
            && step.ScreenshotWidth is > 0 and int width
            && step.ScreenshotHeight is > 0 and int height)
        {
            screenshot = new ReportScreenshot(step.ScreenshotPath, width, height, MarkerGeometry.For(step, width, height, markerSettings));
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
}
