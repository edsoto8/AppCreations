using System.Globalization;
using System.Text.RegularExpressions;
using StepRecorder.Core.Reporting;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed partial class ReportTests : IDisposable
{
    private readonly TempDirectory temp = new();
    private readonly FileSessionStore store = new();

    public void Dispose() => temp.Dispose();

    private static Step NotepadClick(int number, int x = 412, int y = 218) => new()
    {
        StepNumber = number,
        Timestamp = TestEnvironment.Start.AddSeconds(number),
        MouseButton = MouseButton.Left,
        CursorX = 200 + x,
        CursorY = 100 + y,
        ApplicationName = "Notepad",
        ProcessName = "notepad",
        WindowTitle = "Untitled - Notepad",
        WindowClassName = "Notepad",
        WindowBounds = new ScreenRect(200, 100, 800, 600),
        ClickXRelativeToWindow = x,
        ClickYRelativeToWindow = y,
        ScreenshotStatus = ScreenshotStatus.Captured,
        ScreenshotPath = FileSessionStore.ScreenshotRelativePath(number),
        ScreenshotWidth = 800,
        ScreenshotHeight = 600,
        ScreenshotMethod = "PrintWindow",
    };

    private static Session SessionWith(params Step[] steps)
    {
        var session = new Session
        {
            Name = "Invoice bug",
            Status = SessionStatus.Completed,
            StartedAt = TestEnvironment.Start,
            EndedAt = TestEnvironment.Start.AddSeconds(95),
            Duration = TimeSpan.FromSeconds(95),
            ActiveDuration = TimeSpan.FromSeconds(80),
            ApplicationVersion = "1.2.3",
            OperatingSystem = "Windows 11 (test)",
        };
        session.Steps.AddRange(steps);
        return session;
    }

    private Session SavedSessionWithScreenshots(params Step[] steps)
    {
        Session session = SessionWith(steps);
        session.Directory = store.CreateSessionDirectory(temp.Path, session.StartedAt, session.Name);
        foreach (Step step in steps.Where(s => s.ScreenshotPath is not null))
        {
            store.SaveScreenshot(session, step.StepNumber, [0x89, 0x50, 0x4E, 0x47]);
        }

        store.Save(session);
        return session;
    }

    // ---- Descriptions ----

    [Fact]
    public void Describe_ClickInWindow_MatchesSpecExample()
    {
        Step step = NotepadClick(7);
        step.WindowTitle = "MyApplication — Microsoft Visual Studio";

        Assert.Equal("Click at (412, 218) in \"MyApplication — Microsoft Visual Studio\".", StepDescriber.Describe(step));
    }

    [Fact]
    public void Describe_RightClick()
    {
        Step step = new() { MouseButton = MouseButton.Right, ClickXRelativeToWindow = 1, ClickYRelativeToWindow = 2, WindowTitle = "T" };

        Assert.Equal("Right-click at (1, 2) in \"T\".", StepDescriber.Describe(step));
    }

    [Fact]
    public void Describe_WithoutTitle_UsesApplicationName()
    {
        Step step = NotepadClick(1);
        step.WindowTitle = "";

        Assert.Equal("Click at (412, 218) in Notepad.", StepDescriber.Describe(step));
    }

    [Fact]
    public void Describe_WithoutWindow_UsesScreenPosition()
    {
        Step step = new() { MouseButton = MouseButton.Left, CursorX = -5, CursorY = 9 };

        Assert.Equal("Click at screen position (-5, 9).", StepDescriber.Describe(step));
        Assert.Equal(StepDescriber.UnknownApplication, StepDescriber.ApplicationName(step));
    }

    [Theory]
    [InlineData("Progman", "Click on the desktop.")]
    [InlineData("Shell_TrayWnd", "Click on the taskbar.")]
    public void Describe_ShellWindows(string className, string expected)
    {
        Step step = NotepadClick(1);
        step.WindowClassName = className;

        Assert.Equal(expected, StepDescriber.Describe(step));
    }

    [Fact]
    public void Describe_PrefersStoredDescription()
    {
        Step step = NotepadClick(1);
        step.GeneratedDescription = "  Clicked **Save** button.  ";

        Assert.Equal("Clicked **Save** button.", StepDescriber.Describe(step));
    }

    // ---- Model ----

    [Fact]
    public void Build_OrdersStepsAndBuildsHeadings()
    {
        ReportModel report = ReportBuilder.Build(SessionWith(NotepadClick(2), NotepadClick(1), NotepadClick(3)));

        Assert.Equal([1, 2, 3], report.Steps.Select(s => s.Number));
        Assert.Equal("Step 1 — Notepad", report.Steps[0].Heading);
        Assert.Equal("Invoice bug", report.Title);
    }

    [Fact]
    public void Build_MarkerIsClickPositionAsPercentOfScreenshot()
    {
        ReportModel report = ReportBuilder.Build(SessionWith(NotepadClick(1, x: 200, y: 450)));

        ReportScreenshot shot = report.Steps[0].Screenshot!;
        Assert.Equal("screenshots/step-001.png", shot.RelativePath);
        Assert.Equal(new ClickMarker(200, 450, 32, 3), shot.Marker);
    }

    [Theory]
    [InlineData(-3, 10)]
    [InlineData(10, -3)]
    [InlineData(800, 10)]
    [InlineData(10, 600)]
    public void Build_ClickOutsideScreenshot_HasNoMarker(int x, int y)
    {
        ReportModel report = ReportBuilder.Build(SessionWith(NotepadClick(1, x, y)));

        Assert.NotNull(report.Steps[0].Screenshot);
        Assert.Null(report.Steps[0].Screenshot!.Marker);
    }

    [Fact]
    public void Build_UnavailableScreenshot_KeepsNoteAndNoImage()
    {
        Step step = NotepadClick(1);
        step.ScreenshotStatus = ScreenshotStatus.Unavailable;
        step.ScreenshotPath = null;
        step.ScreenshotNote = "The window is minimized.";

        ReportStep reportStep = ReportBuilder.Build(SessionWith(step)).Steps[0];

        Assert.Null(reportStep.Screenshot);
        Assert.Equal("The window is minimized.", reportStep.ScreenshotNote);
    }

    // ---- HTML ----

    [Fact]
    public void Html_ShowsEveryStepInOrderWithRelativeImages()
    {
        string html = HtmlReportExporter.Render(ReportBuilder.Build(SessionWith(NotepadClick(1), NotepadClick(2))));

        int first = html.IndexOf("id=\"step-1\"", StringComparison.Ordinal);
        int second = html.IndexOf("id=\"step-2\"", StringComparison.Ordinal);
        Assert.True(first > 0 && second > first);
        Assert.Contains("<img src=\"screenshots/step-001.png\" width=\"800\" height=\"600\"", html);
        Assert.Contains("Step 2 — Notepad", html);
        Assert.Contains("Click at (412, 218) in &quot;Untitled - Notepad&quot;.", html);
        Assert.Contains("<link rel=\"stylesheet\" href=\"assets/report.css\">", html);
        Assert.DoesNotContain("http://", html);
        Assert.DoesNotContain("https://", html);
    }

    [Fact]
    public void Html_EscapesWindowTitlesAndNames()
    {
        Step step = NotepadClick(1);
        step.WindowTitle = "<script>alert('x')</script> & \"quotes\"";
        Session session = SessionWith(step);
        session.Name = "<b>bold</b>";

        string html = HtmlReportExporter.Render(ReportBuilder.Build(session));

        Assert.DoesNotContain("<script>alert", html);
        Assert.DoesNotContain("<b>bold</b>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("&lt;b&gt;bold&lt;/b&gt;", html);
    }

    [Fact]
    public void Html_MarkerIsSvgInScreenshotPixels_InAnyCulture()
    {
        CultureInfo original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            string html = HtmlReportExporter.Render(ReportBuilder.Build(SessionWith(NotepadClick(1, x: 401, y: 1))));

            Assert.Contains("<svg class=\"click-marker\" viewBox=\"0 0 800 600\"", html);
            Assert.Contains("<circle class=\"ring\" cx=\"401\" cy=\"1\" r=\"14.5\" stroke-width=\"3\" />", html);
            Assert.Contains("aria-label=\"Click position (401, 1)\"", html);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Html_ShowsNoteInsteadOfMissingScreenshot()
    {
        Step step = NotepadClick(1);
        step.ScreenshotStatus = ScreenshotStatus.Unavailable;
        step.ScreenshotNote = "Access is denied.";

        string html = HtmlReportExporter.Render(ReportBuilder.Build(SessionWith(step)));

        Assert.DoesNotContain("<img", html);
        Assert.Contains("<strong>No screenshot:</strong> Access is denied.", html);
    }

    [Fact]
    public void Html_EmptySession_SaysSo()
    {
        string html = HtmlReportExporter.Render(ReportBuilder.Build(SessionWith()));

        Assert.Contains("No steps were recorded.", html);
    }

    [Fact]
    public void Html_InterruptedSession_IsLabelledIncomplete()
    {
        Session session = SessionWith(NotepadClick(1));
        session.Status = SessionStatus.Recording;

        Assert.Contains("Incomplete", HtmlReportExporter.Render(ReportBuilder.Build(session)));
    }

    // ---- Markdown ----

    [Fact]
    public void Markdown_ShowsStepsWithRelativeImages()
    {
        string md = MarkdownReportExporter.Render(ReportBuilder.Build(SessionWith(NotepadClick(1), NotepadClick(2))));

        Assert.StartsWith("# Invoice bug\n", md);
        Assert.Contains("- **Duration:** 1:35\n", md);
        Assert.Contains("## Step 1 — Notepad\n", md);
        Assert.Contains("![Step 1 screenshot](screenshots/step-001.png)", md);
        Assert.Contains("![Step 2 screenshot](screenshots/step-002.png)", md);
        Assert.True(md.IndexOf("## Step 1", StringComparison.Ordinal) < md.IndexOf("## Step 2", StringComparison.Ordinal));
    }

    [Fact]
    public void Markdown_EscapesFormattingInTitles()
    {
        Step step = NotepadClick(1);
        step.WindowTitle = "*draft* [1] <b> `code` #tag\nline2";

        string md = MarkdownReportExporter.Render(ReportBuilder.Build(SessionWith(step)));

        Assert.Contains(@"in ""\*draft\* \[1\] \<b\> \`code\` \#tag line2"".", md);
    }

    [Fact]
    public void Markdown_ShowsNoteForMissingScreenshot()
    {
        Step step = NotepadClick(1);
        step.ScreenshotStatus = ScreenshotStatus.Skipped;
        step.ScreenshotNote = "Clicks on the desktop are not captured.";

        string md = MarkdownReportExporter.Render(ReportBuilder.Build(SessionWith(step)));

        Assert.DoesNotContain("![", md);
        Assert.Contains("> **No screenshot:** Clicks on the desktop are not captured.", md);
    }

    [Fact]
    public void UrlPath_EncodesEachSegment()
    {
        Assert.Equal("screenshots/step%20one%23.png", ReportText.UrlPath("screenshots/step one#.png"));
    }

    // ---- Generator ----

    [Theory]
    [InlineData(true, true, new[] { "report.html", "report.md" })]
    [InlineData(true, false, new[] { "report.html" })]
    [InlineData(false, true, new[] { "report.md" })]
    [InlineData(false, false, new[] { "report.html" })]
    public void Generate_WritesSelectedFormats(bool html, bool markdown, string[] expected)
    {
        Session session = SavedSessionWithScreenshots(NotepadClick(1));

        IReadOnlyList<string> written = new ReportGenerator().Generate(
            session,
            new RecorderSettings { Reports = new ReportSettings { GenerateHtml = html, GenerateMarkdown = markdown } });

        Assert.Equal(expected, written.Select(Path.GetFileName));
        Assert.All(written, path => Assert.True(File.Exists(path)));
        Assert.Equal(html || !markdown, File.Exists(Path.Combine(session.Directory, "assets", "report.css")));
    }

    [Fact]
    public void Generate_MovedSessionFolder_StillResolvesEveryLink()
    {
        Session session = SavedSessionWithScreenshots(NotepadClick(1), NotepadClick(2));
        new ReportGenerator().Generate(session, new RecorderSettings());

        string moved = Path.Combine(temp.Path, "elsewhere", "copied session");
        Directory.CreateDirectory(Path.GetDirectoryName(moved)!);
        Directory.Move(session.Directory, moved);

        string html = File.ReadAllText(Path.Combine(moved, "report.html"));
        string md = File.ReadAllText(Path.Combine(moved, "report.md"));
        List<string> links =
        [
            .. HtmlLinkPattern().Matches(html).Select(m => m.Groups[1].Value),
            .. MarkdownImagePattern().Matches(md).Select(m => m.Groups[1].Value),
        ];

        Assert.True(links.Count >= 6);
        Assert.All(links, link =>
        {
            Assert.False(Path.IsPathRooted(link), link);
            Assert.True(File.Exists(Path.Combine(moved, Uri.UnescapeDataString(link))), $"Missing {link}");
        });
        Assert.DoesNotContain(temp.Path, html);
        Assert.DoesNotContain(temp.Path, md);
    }

    [Fact]
    public void Generate_OverwritesPreviousReport()
    {
        Session session = SavedSessionWithScreenshots(NotepadClick(1));
        new ReportGenerator().Generate(session, new RecorderSettings());
        session.Name = "Renamed";

        new ReportGenerator().Generate(session, new RecorderSettings());

        Assert.Contains("<h1>Renamed</h1>", File.ReadAllText(Path.Combine(session.Directory, "report.html")));
        Assert.Empty(Directory.GetFiles(session.Directory, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public void Settings_ReportSectionRoundTripsAndDefaultsOn()
    {
        string path = Path.Combine(temp.Path, "settings.json");
        var settingsStore = new JsonSettingsStore(path);
        Assert.True(settingsStore.Load().Reports.GenerateHtml);
        Assert.True(settingsStore.Load().Reports.GenerateMarkdown);

        var settings = new RecorderSettings { Reports = new ReportSettings { GenerateMarkdown = false } };
        settingsStore.Save(settings);

        Assert.Equal(settings, settingsStore.Load());
    }

    [GeneratedRegex("(?:src|href)=\"(?!#)([^\"]+)\"")]
    private static partial Regex HtmlLinkPattern();

    [GeneratedRegex(@"!\[[^\]]*\]\(([^)]+)\)")]
    private static partial Regex MarkdownImagePattern();
}
