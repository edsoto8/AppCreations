using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Core.Reporting;

/// <summary>
/// Builds the shared report model once, makes marked screenshot copies when a format needs them, and
/// hands the model to each enabled exporter.
/// </summary>
/// <param name="annotator">Draws markers into copies. Without one, Markdown links the unmarked originals.</param>
public sealed class ReportGenerator(IScreenshotAnnotator? annotator = null, ILogger? logger = null)
{
    /// <summary>Marked copies live here, so the originals in <c>screenshots/</c> are never touched.</summary>
    public const string MarkedFolder = FileSessionStore.ScreenshotsFolderName + "/marked";

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
    /// Writes every enabled report into the session folder, using the current marker settings (so
    /// regenerating after changing them updates the markers). One format failing does not stop the others.
    /// </summary>
    /// <returns>Full paths of the reports that were written, HTML first when enabled.</returns>
    public IReadOnlyList<string> Generate(Session session, RecorderSettings settings)
    {
        IReadOnlyList<IReportExporter> exporters = ExportersFor(settings.Reports);
        ReportModel model = ReportBuilder.Build(session, settings.Screenshot);

        // The HTML report overlays its marker; only Markdown needs pixels with the marker drawn in.
        if (exporters.Any(e => e is MarkdownReportExporter))
        {
            model = WithMarkedCopies(model, session.Directory);
        }

        var written = new List<string>();
        foreach (IReportExporter exporter in exporters)
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

    private ReportModel WithMarkedCopies(ReportModel model, string sessionDirectory)
    {
        // Start clean, so markers switched off or steps deleted since the last report leave nothing behind.
        string markedDirectory = Path.Combine(sessionDirectory, MarkedFolder.Replace('/', Path.DirectorySeparatorChar));
        TryDeleteDirectory(markedDirectory);

        if (annotator is null || model.Steps.All(s => s.Screenshot?.Marker is null))
        {
            return model;
        }

        var steps = new List<ReportStep>(model.Steps.Count);
        foreach (ReportStep step in model.Steps)
        {
            steps.Add(step.Screenshot is { Marker: { } marker } shot
                ? step with { Screenshot = shot with { MarkedRelativePath = MarkCopy(sessionDirectory, shot, marker) } }
                : step);
        }

        return model with { Steps = steps };
    }

    /// <returns>The marked copy's relative path, or null when it could not be made.</returns>
    private string? MarkCopy(string sessionDirectory, ReportScreenshot shot, ClickMarker marker)
    {
        string relative = $"{MarkedFolder}/{shot.RelativePath.Split('/')[^1]}";
        try
        {
            string source = FileSessionStore.ResolveInSession(sessionDirectory, shot.RelativePath);
            string destination = FileSessionStore.ResolveInSession(sessionDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            annotator!.DrawClickMarker(source, destination, marker);
            return relative;
        }
        catch (Exception ex)
        {
            // The report still works with the unmarked original.
            logger.LogWarning(ex, "Could not draw the click marker on {Screenshot}", shot.RelativePath);
            return null;
        }
    }

    private void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Could not clear old marked screenshots in {Directory}", path);
        }
    }
}
