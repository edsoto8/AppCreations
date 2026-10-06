using StepRecorder.Core.Sessions;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class SessionStorageTests : IDisposable
{
    private readonly TempDirectory temp = new();
    private readonly FileSessionStore store = new();

    public void Dispose() => temp.Dispose();

    private Session SaveSession(DateTimeOffset startedAt, string name = "Test")
    {
        var session = new Session
        {
            Name = name,
            StartedAt = startedAt,
            Directory = store.CreateSessionDirectory(temp.Path, startedAt, name),
        };
        store.Save(session);
        return session;
    }

    [Fact]
    public void CreateSessionDirectory_UsesTimestampAndNameAndAddsScreenshotsFolder()
    {
        string path = store.CreateSessionDirectory(temp.Path, TestEnvironment.Start, "Bug 42");

        Assert.Equal(Path.Combine(temp.Path, "2026-10-05_175700_Bug-42"), path);
        Assert.True(Directory.Exists(Path.Combine(path, FileSessionStore.ScreenshotsFolderName)));
    }

    [Fact]
    public void CreateSessionDirectory_AddsSuffixWhenFolderExists()
    {
        string first = store.CreateSessionDirectory(temp.Path, TestEnvironment.Start, "Test");
        string second = store.CreateSessionDirectory(temp.Path, TestEnvironment.Start, "Test");
        string third = store.CreateSessionDirectory(temp.Path, TestEnvironment.Start, "Test");

        Assert.Equal(first + "-2", second);
        Assert.Equal(first + "-3", third);
    }

    [Fact]
    public void CreateSessionDirectory_CreatesMissingRecordingsFolder()
    {
        string root = Path.Combine(temp.Path, "does", "not", "exist");

        string path = store.CreateSessionDirectory(root, TestEnvironment.Start, "Test");

        Assert.True(Directory.Exists(path));
    }

    [Fact]
    public void SaveAndLoad_RoundTripsSessionAndSteps()
    {
        Session session = SaveSession(TestEnvironment.Start);
        session.Steps.Add(new Step
        {
            StepNumber = 1,
            Timestamp = TestEnvironment.Start.AddSeconds(3),
            EventType = StepEventType.Click,
            MouseButton = MouseButton.Left,
            CursorX = 100,
            CursorY = -20,
            WindowTitle = "Untitled - Notepad",
            WindowBounds = new ScreenRect(-1920, 0, 800, 600),
        });
        store.Save(session);

        Session loaded = store.Load(session.Directory);

        Assert.Equal(session.SessionId, loaded.SessionId);
        Assert.Equal(1, loaded.StepCount);
        Step step = Assert.Single(loaded.Steps);
        Assert.Equal(MouseButton.Left, step.MouseButton);
        Assert.Equal(new ScreenRect(-1920, 0, 800, 600), step.WindowBounds);
        Assert.Equal("Untitled - Notepad", step.WindowTitle);
    }

    [Fact]
    public void SessionJson_ContainsNoAbsolutePaths()
    {
        Session session = SaveSession(TestEnvironment.Start);

        string json = File.ReadAllText(Path.Combine(session.Directory, FileSessionStore.SessionFileName));

        Assert.DoesNotContain(temp.Path, json);
        Assert.DoesNotContain(temp.Path.Replace("\\", "\\\\"), json);
    }

    [Fact]
    public void Save_LeavesNoTempFileBehind()
    {
        Session session = SaveSession(TestEnvironment.Start);
        store.Save(session);

        Assert.Equal(
            [FileSessionStore.SessionFileName],
            Directory.GetFiles(session.Directory).Select(Path.GetFileName));
    }

    [Fact]
    public void Load_AfterFolderIsMoved_UsesNewLocation()
    {
        Session session = SaveSession(TestEnvironment.Start);
        string moved = Path.Combine(temp.Path, "moved");
        Directory.Move(session.Directory, moved);

        Session loaded = store.Load(moved);

        Assert.Equal(Path.GetFullPath(moved), loaded.Directory);
        Assert.Equal(session.SessionId, loaded.SessionId);
    }

    [Fact]
    public void FindMostRecent_ReturnsLatestStartAndSkipsBrokenFolders()
    {
        SaveSession(TestEnvironment.Start.AddHours(-2), "Older");
        Session newest = SaveSession(TestEnvironment.Start, "Newest");
        SaveSession(TestEnvironment.Start.AddHours(-1), "Middle");

        string corrupt = Directory.CreateDirectory(Path.Combine(temp.Path, "corrupt")).FullName;
        File.WriteAllText(Path.Combine(corrupt, FileSessionStore.SessionFileName), "{ not json");
        Directory.CreateDirectory(Path.Combine(temp.Path, "unrelated-folder"));

        Session? found = store.FindMostRecent(temp.Path);

        Assert.NotNull(found);
        Assert.Equal(newest.SessionId, found.SessionId);
    }

    [Fact]
    public void FindMostRecent_WithNoSessions_ReturnsNull()
    {
        Assert.Null(store.FindMostRecent(temp.Path));
        Assert.Null(store.FindMostRecent(Path.Combine(temp.Path, "missing")));
    }

    [Theory]
    [InlineData(1, "screenshots/step-001.png")]
    [InlineData(42, "screenshots/step-042.png")]
    [InlineData(1234, "screenshots/step-1234.png")]
    public void ScreenshotPaths_AreDeterministicAndRelative(int stepNumber, string expected)
    {
        Assert.Equal(expected, FileSessionStore.ScreenshotRelativePath(stepNumber));
    }

    [Fact]
    public void SaveScreenshot_WritesFileAndDeleteRemovesIt()
    {
        Session session = SaveSession(TestEnvironment.Start);

        string relative = store.SaveScreenshot(session, 7, [1, 2, 3]);
        string full = Path.Combine(session.Directory, "screenshots", "step-007.png");

        Assert.Equal("screenshots/step-007.png", relative);
        Assert.Equal(new byte[] { 1, 2, 3 }, File.ReadAllBytes(full));

        store.DeleteScreenshot(session, relative);
        Assert.False(File.Exists(full));
        store.DeleteScreenshot(session, relative); // already gone: no error
    }

    [Fact]
    public void SaveScreenshot_RecreatesMissingScreenshotsFolder()
    {
        Session session = SaveSession(TestEnvironment.Start);
        Directory.Delete(Path.Combine(session.Directory, "screenshots"));

        store.SaveScreenshot(session, 1, [9]);

        Assert.True(File.Exists(Path.Combine(session.Directory, "screenshots", "step-001.png")));
    }

    [Fact]
    public void DeleteScreenshot_RefusesPathsOutsideTheSession()
    {
        Session session = SaveSession(TestEnvironment.Start);
        string outside = Path.Combine(temp.Path, "keep.txt");
        File.WriteAllText(outside, "x");

        Assert.Throws<ArgumentException>(() => store.DeleteScreenshot(session, "../keep.txt"));
        Assert.True(File.Exists(outside));
    }

    [Fact]
    public void ScreenshotsSurviveMovingTheSessionFolder()
    {
        Session session = SaveSession(TestEnvironment.Start);
        session.Steps.Add(new Step { StepNumber = 1, ScreenshotPath = store.SaveScreenshot(session, 1, [5]) });
        store.Save(session);
        string moved = Path.Combine(temp.Path, "zipped-and-extracted");
        Directory.Move(session.Directory, moved);

        Session loaded = store.Load(moved);

        string screenshot = Path.Combine(loaded.Directory, loaded.Steps[0].ScreenshotPath!);
        Assert.Equal(new byte[] { 5 }, File.ReadAllBytes(screenshot));
    }
}
