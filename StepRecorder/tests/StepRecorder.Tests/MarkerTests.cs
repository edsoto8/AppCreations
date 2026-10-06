using StepRecorder.Core.Reporting;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class MarkerTests : IDisposable
{
    private readonly TempDirectory temp = new();
    private readonly FileSessionStore store = new();

    public void Dispose() => temp.Dispose();

    private static Step Click(int number, int x, int y, int? dpi = null, ScreenshotFormat format = ScreenshotFormat.Png) => new()
    {
        StepNumber = number,
        Timestamp = TestEnvironment.Start.AddSeconds(number),
        MouseButton = MouseButton.Left,
        ApplicationName = "Notepad",
        WindowTitle = "Untitled - Notepad",
        ClickXRelativeToWindow = x,
        ClickYRelativeToWindow = y,
        WindowDpi = dpi,
        ScreenshotStatus = ScreenshotStatus.Captured,
        ScreenshotPath = FileSessionStore.ScreenshotRelativePath(number, format),
        ScreenshotWidth = 800,
        ScreenshotHeight = 600,
    };

    private Session SavedSession(params Step[] steps)
    {
        var session = new Session { Name = "Markers", StartedAt = TestEnvironment.Start, Status = SessionStatus.Completed };
        session.Directory = store.CreateSessionDirectory(temp.Path, session.StartedAt, session.Name);
        foreach (Step step in steps)
        {
            ScreenshotFormat format = step.ScreenshotPath!.EndsWith(".jpg", StringComparison.Ordinal) ? ScreenshotFormat.Jpeg : ScreenshotFormat.Png;
            store.SaveScreenshot(session, step.StepNumber, [(byte)step.StepNumber], format);
        }

        session.Steps.AddRange(steps);
        store.Save(session);
        return session;
    }

    // ---- Geometry ----

    [Theory]
    [InlineData(null, 32, 3)]   // unknown DPI: treated as 96
    [InlineData(96, 32, 3)]     // 100%
    [InlineData(120, 40, 4)]    // 125%
    [InlineData(144, 48, 5)]    // 150%
    [InlineData(192, 64, 6)]    // 200%
    public void Marker_ScalesWithWindowDpi(int? dpi, int diameter, int stroke)
    {
        ClickMarker? marker = MarkerGeometry.For(Click(1, 100, 50, dpi), 800, 600, new ScreenshotSettings());

        Assert.Equal(new ClickMarker(100, 50, diameter, stroke), marker);
    }

    [Fact]
    public void Marker_IsCentredOnTheWindowRelativeClick()
    {
        ClickMarker marker = MarkerGeometry.For(Click(1, 0, 599), 800, 600, new ScreenshotSettings())!.Value;

        Assert.Equal((0, 599), (marker.X, marker.Y));
        Assert.Equal(14.5, marker.Radius);
    }

    [Fact]
    public void Marker_UsesConfiguredSizeAndIsClamped()
    {
        Assert.Equal(20, MarkerGeometry.For(Click(1, 1, 1), 800, 600, new ScreenshotSettings { ClickMarkerSize = 20 })!.Value.Diameter);
        Assert.Equal(ScreenshotSettings.MaxMarkerSize, MarkerGeometry.For(Click(1, 1, 1), 800, 600, new ScreenshotSettings { ClickMarkerSize = 999 })!.Value.Diameter);
    }

    [Fact]
    public void Marker_Disabled_IsNull()
    {
        Assert.Null(MarkerGeometry.For(Click(1, 1, 1), 800, 600, new ScreenshotSettings { ClickMarkerEnabled = false }));
    }

    [Fact]
    public void Settings_ClampOutOfRangeValuesOnLoad()
    {
        string path = Path.Combine(temp.Path, "settings.json");
        File.WriteAllText(path, """{ "screenshot": { "format": "Jpeg", "jpegQuality": 500, "clickMarkerSize": 1 } }""");

        ScreenshotSettings loaded = new JsonSettingsStore(path).Load().Screenshot;

        Assert.Equal(ScreenshotFormat.Jpeg, loaded.Format);
        Assert.Equal(ScreenshotSettings.MaxJpegQuality, loaded.JpegQuality);
        Assert.Equal(ScreenshotSettings.MinMarkerSize, loaded.ClickMarkerSize);
    }

    // ---- Marked copies ----

    [Fact]
    public void Markdown_LinksMarkedCopies_HtmlKeepsOriginals()
    {
        var annotator = new FakeAnnotator();
        Session session = SavedSession(Click(1, 100, 50, dpi: 144), Click(2, 10, 10));

        new ReportGenerator(annotator).Generate(session, new RecorderSettings());

        Assert.Equal(2, annotator.Calls.Count);
        Assert.Equal(new ClickMarker(100, 50, 48, 5), annotator.Calls[0].Marker);
        Assert.EndsWith(Path.Combine("screenshots", "step-001.png"), annotator.Calls[0].Source);
        Assert.EndsWith(Path.Combine("screenshots", "marked", "step-001.png"), annotator.Calls[0].Destination);

        string md = File.ReadAllText(Path.Combine(session.Directory, "report.md"));
        string html = File.ReadAllText(Path.Combine(session.Directory, "report.html"));
        Assert.Contains("](screenshots/marked/step-001.png)", md);
        Assert.Contains("src=\"screenshots/step-001.png\"", html);
        Assert.DoesNotContain("marked/", html);
        Assert.Equal([1], File.ReadAllBytes(Path.Combine(session.Directory, "screenshots", "step-001.png")));
    }

    [Fact]
    public void MarkedCopies_KeepJpegExtension()
    {
        var annotator = new FakeAnnotator();
        Session session = SavedSession(Click(1, 5, 5, format: ScreenshotFormat.Jpeg));

        new ReportGenerator(annotator).Generate(session, new RecorderSettings());

        Assert.Contains("](screenshots/marked/step-001.jpg)", File.ReadAllText(Path.Combine(session.Directory, "report.md")));
    }

    [Fact]
    public void MarkersOff_RemovesOldMarkedCopiesAndLinksOriginals()
    {
        var annotator = new FakeAnnotator();
        Session session = SavedSession(Click(1, 5, 5));
        new ReportGenerator(annotator).Generate(session, new RecorderSettings());
        Assert.True(Directory.Exists(Path.Combine(session.Directory, "screenshots", "marked")));

        var off = new RecorderSettings { Screenshot = new ScreenshotSettings { ClickMarkerEnabled = false } };
        new ReportGenerator(annotator).Generate(session, off);

        Assert.False(Directory.Exists(Path.Combine(session.Directory, "screenshots", "marked")));
        string md = File.ReadAllText(Path.Combine(session.Directory, "report.md"));
        string html = File.ReadAllText(Path.Combine(session.Directory, "report.html"));
        Assert.Contains("](screenshots/step-001.png)", md);
        Assert.DoesNotContain("click-marker\" viewBox", html);
    }

    [Fact]
    public void AnnotatorFailure_FallsBackToOriginal()
    {
        var annotator = new FakeAnnotator { Fail = true };
        Session session = SavedSession(Click(1, 5, 5));

        IReadOnlyList<string> written = new ReportGenerator(annotator).Generate(session, new RecorderSettings());

        Assert.Equal(2, written.Count);
        Assert.Contains("](screenshots/step-001.png)", File.ReadAllText(Path.Combine(session.Directory, "report.md")));
    }

    [Fact]
    public void HtmlOnly_MakesNoMarkedCopies()
    {
        var annotator = new FakeAnnotator();
        Session session = SavedSession(Click(1, 5, 5));

        new ReportGenerator(annotator).Generate(session, new RecorderSettings { Reports = new ReportSettings { GenerateMarkdown = false } });

        Assert.Empty(annotator.Calls);
    }

    [Fact]
    public void WithoutAnnotator_MarkdownLinksOriginals()
    {
        Session session = SavedSession(Click(1, 5, 5));

        new ReportGenerator().Generate(session, new RecorderSettings());

        Assert.Contains("](screenshots/step-001.png)", File.ReadAllText(Path.Combine(session.Directory, "report.md")));
    }

    [Theory]
    [InlineData(MouseButton.Left, 2, "Double-click at (5, 5) in \"Untitled - Notepad\".")]
    [InlineData(MouseButton.Left, 3, "Triple-click at (5, 5) in \"Untitled - Notepad\".")]
    [InlineData(MouseButton.Right, 2, "Double right-click at (5, 5) in \"Untitled - Notepad\".")]
    [InlineData(MouseButton.Left, 5, "Click (5 times) at (5, 5) in \"Untitled - Notepad\".")]
    public void Describe_CountsRepeatedClicks(MouseButton button, int count, string expected)
    {
        Step step = new()
        {
            MouseButton = button,
            ClickCount = count,
            WindowTitle = "Untitled - Notepad",
            ClickXRelativeToWindow = 5,
            ClickYRelativeToWindow = 5,
        };

        Assert.Equal(expected, StepDescriber.Describe(step));
    }

    private sealed class FakeAnnotator : IScreenshotAnnotator
    {
        public List<(string Source, string Destination, ClickMarker Marker)> Calls { get; } = [];

        public bool Fail { get; set; }

        public void DrawClickMarker(string sourcePath, string destinationPath, ClickMarker marker)
        {
            if (Fail)
            {
                throw new InvalidOperationException("Simulated GDI+ failure.");
            }

            Calls.Add((sourcePath, destinationPath, marker));
            File.Copy(sourcePath, destinationPath, overwrite: true);
        }
    }
}
