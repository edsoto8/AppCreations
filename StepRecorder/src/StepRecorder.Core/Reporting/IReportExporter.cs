namespace StepRecorder.Core.Reporting;

/// <summary>
/// Writes one report format into a session folder. New formats (PDF, ZIP; spec §15) implement this
/// without touching the recording engine.
/// </summary>
public interface IReportExporter
{
    /// <summary>The main file written, relative to the session folder, such as <c>report.html</c>.</summary>
    string FileName { get; }

    void Export(ReportModel report, string sessionDirectory);
}
