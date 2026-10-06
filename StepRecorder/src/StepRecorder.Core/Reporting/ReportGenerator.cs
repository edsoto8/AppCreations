using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Reporting;

/// <summary>Builds the shared report model once and hands it to each enabled exporter.</summary>
public sealed class ReportGenerator(ILogger? logger = null)
{
    private readonly ILogger logger = logger ?? NullLogger.Instance;

    public static IReadOnlyList<IReportExporter> ExportersFor(ReportSettings settings)
    {
        var exporters = new List<IReportExporter>();
        if (settings.GenerateHtml)
        {
            exporters.Add(new HtmlReportExporter());
        }

        if (settings.GenerateMarkdown)
        {
            exporters.Add(new MarkdownReportExporter());
        }

        // A recording always gets a readable report, even if both formats were switched off.
        if (exporters.Count == 0)
        {
            exporters.Add(new HtmlReportExporter());
        }

        return exporters;
    }

    /// <summary>
    /// Writes every enabled report into the session folder. One format failing does not stop the others.
    /// </summary>
    /// <returns>Full paths of the reports that were written, HTML first when enabled.</returns>
    public IReadOnlyList<string> Generate(Session session, ReportSettings settings)
    {
        ReportModel model = ReportBuilder.Build(session);
        var written = new List<string>();

        foreach (IReportExporter exporter in ExportersFor(settings))
        {
            try
            {
                exporter.Export(model, session.Directory);
                written.Add(Path.Combine(session.Directory, exporter.FileName));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                logger.LogError(ex, "Could not write {Report} for session {SessionId}", exporter.FileName, session.SessionId);
            }
        }

        logger.LogInformation("Wrote {Count} report(s) for session {SessionId}", written.Count, session.SessionId);
        return written;
    }
}
