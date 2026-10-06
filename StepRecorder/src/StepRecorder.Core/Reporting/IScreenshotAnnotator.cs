namespace StepRecorder.Core.Reporting;

/// <summary>
/// Draws a click marker into a copy of a screenshot (spec §10: "marker rendered into a report copy or
/// screenshot copy"). The original is never modified; it is the evidence.
/// </summary>
public interface IScreenshotAnnotator
{
    /// <summary>Reads <paramref name="sourcePath"/>, draws the ring and writes <paramref name="destinationPath"/> in the same format.</summary>
    void DrawClickMarker(string sourcePath, string destinationPath, ClickMarker marker);
}
