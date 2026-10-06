using StepRecorder.Core.Capture;
using StepRecorder.Core.Input;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class ClickRecorderTests : IDisposable
{
    private const int OwnProcessId = 4242;

    private static readonly WindowInfo Notepad = new(
        Handle: 0x1001,
        ProcessId: 100,
        ProcessName: "notepad",
        ApplicationName: "Notepad",
        Title: "Untitled - Notepad",
        ClassName: "Notepad",
        Bounds: new ScreenRect(200, 100, 800, 600),
        Dpi: 96);

    private static readonly WindowInfo Calculator = Notepad with
    {
        Handle = 0x2002,
        ProcessId = 200,
        ProcessName = "CalculatorApp",
        ApplicationName = "Calculator",
        Title = "Calculator",
        ClassName = "ApplicationFrameWindow",
        Bounds = new ScreenRect(-1500, 50, 400, 600),
        Dpi = 144,
    };

    private static readonly WindowInfo Taskbar = Notepad with
    {
        Handle = 0x3003,
        ProcessId = 300,
        ProcessName = "explorer",
        ApplicationName = "Windows Explorer",
        Title = "",
        ClassName = "Shell_TrayWnd",
        Bounds = new ScreenRect(0, 1040, 1920, 40),
    };

    private static readonly WindowInfo OwnWindow = Notepad with { ProcessId = OwnProcessId, Title = "Step Recorder Settings" };

    private readonly TempDirectory temp = new();
    private readonly ManualTimeProvider clock = new(TestEnvironment.Start);
    private readonly FakeClickSource source = new();
    private readonly FakeWindowInspector inspector = new();
    private readonly FakeWindowCapture capture = new();
    private readonly FlakySessionStore store = new(new FileSessionStore());
    private readonly Recorder recorder;
    private readonly ClickRecorder clicks;

    public ClickRecorderTests()
    {
        recorder = new Recorder(store, TestEnvironment.Environment, clock);
        clicks = new ClickRecorder(recorder, source, inspector, capture, OwnProcessId, clock);
    }

    public void Dispose()
    {
        clicks.Dispose();
        temp.Dispose();
    }

    private Session Start(RecordingSettings? settings = null) =>
        recorder.Start(temp.Path, "Test", settings ?? new RecordingSettings());

    private static MouseClick ClickAt(int x, int y, MouseButton button = MouseButton.Left, int secondsIn = 0) =>
        new(button, x, y, TestEnvironment.Start.AddSeconds(secondsIn));

    [Fact]
    public void Source_RunsOnlyWhileRecording()
    {
        Assert.False(source.IsRunning);

        Start();
        Assert.True(source.IsRunning);

        recorder.Pause();
        Assert.False(source.IsRunning);

        recorder.Resume();
        Assert.True(source.IsRunning);

        recorder.Stop();
        Assert.False(source.IsRunning);
    }

    [Fact]
    public async Task Click_BecomesStepWithWindowDetails()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;

        source.Click(ClickAt(250, 130, secondsIn: 2));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal(1, step.StepNumber);
        Assert.Equal(StepEventType.Click, step.EventType);
        Assert.Equal(MouseButton.Left, step.MouseButton);
        Assert.Equal(TestEnvironment.Start.AddSeconds(2), step.Timestamp);
        Assert.Equal((250, 130), (step.CursorX, step.CursorY));
        Assert.Equal("Notepad", step.ApplicationName);
        Assert.Equal("notepad", step.ProcessName);
        Assert.Equal(100, step.ProcessId);
        Assert.Equal(0x1001, step.WindowHandle);
        Assert.Equal("Untitled - Notepad", step.WindowTitle);
        Assert.Equal(new ScreenRect(200, 100, 800, 600), step.WindowBounds);
        Assert.Equal(96, step.WindowDpi);
        Assert.Equal((50, 30), (step.ClickXRelativeToWindow, step.ClickYRelativeToWindow));
    }

    [Fact]
    public async Task ClicksAcrossApplications_AreNumberedInOrderAndPersisted()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Windows[(-1400, 200)] = Calculator;

        source.Click(ClickAt(250, 130, secondsIn: 1));
        source.Click(ClickAt(-1400, 200, MouseButton.Right, secondsIn: 2));
        source.Click(ClickAt(250, 130, secondsIn: 3));
        await clicks.FlushAsync();

        Session saved = new FileSessionStore().Load(session.Directory);
        Assert.Equal([1, 2, 3], saved.Steps.Select(s => s.StepNumber));
        Assert.Equal(["Notepad", "Calculator", "Notepad"], saved.Steps.Select(s => s.ApplicationName));
        Assert.Equal(MouseButton.Right, saved.Steps[1].MouseButton);
    }

    [Fact]
    public async Task WindowOnNegativeMonitor_GetsCorrectRelativePosition()
    {
        Session session = Start();
        inspector.Windows[(-1400, 200)] = Calculator;

        source.Click(ClickAt(-1400, 200));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal((100, 150), (step.ClickXRelativeToWindow, step.ClickYRelativeToWindow));
        Assert.Equal(144, step.WindowDpi);
    }

    [Fact]
    public async Task ClicksOnOwnWindows_AreIgnored()
    {
        Session session = Start();
        inspector.Windows[(10, 10)] = OwnWindow;

        source.Click(ClickAt(10, 10));
        await clicks.FlushAsync();

        Assert.Empty(session.Steps);
    }

    [Fact]
    public async Task DisabledButtonsAndMiddleClicks_AreIgnored()
    {
        Session session = Start(new RecordingSettings { CaptureRightClick = false });
        inspector.Windows[(250, 130)] = Notepad;

        source.Click(ClickAt(250, 130, MouseButton.Right));
        source.Click(ClickAt(250, 130, MouseButton.Middle));
        source.Click(ClickAt(250, 130, MouseButton.Left));
        await clicks.FlushAsync();

        Assert.Equal([MouseButton.Left], session.Steps.Select(s => s.MouseButton!.Value));
    }

    [Fact]
    public async Task WindowLookupFailure_StillRecordsClickPosition()
    {
        Session session = Start();
        inspector.ThrowOnLookup = true;

        source.Click(ClickAt(5, 6));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal((5, 6), (step.CursorX, step.CursorY));
        Assert.Null(step.WindowTitle);
        Assert.Null(step.ClickXRelativeToWindow);
    }

    [Fact]
    public async Task NoWindowFound_StillRecordsClickPosition()
    {
        Session session = Start();

        source.Click(ClickAt(5, 6));
        await clicks.FlushAsync();

        Assert.Null(Assert.Single(session.Steps).ApplicationName);
    }

    [Fact]
    public async Task ClickQueuedBeforePause_IsNotRecordedAfterPause()
    {
        Session session = Start();
        inspector.Block();
        source.Click(ClickAt(250, 130));
        recorder.Pause();
        inspector.Release();
        await clicks.FlushAsync();

        Assert.Empty(session.Steps);
    }

    [Fact]
    public async Task RapidClicks_AreAllRecordedInOrder()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;

        for (int i = 0; i < 200; i++)
        {
            source.Click(ClickAt(250, 130, secondsIn: i));
        }

        await clicks.FlushAsync();

        Assert.Equal(Enumerable.Range(1, 200), session.Steps.Select(s => s.StepNumber));
        Assert.Equal(Enumerable.Range(0, 200).Select(i => TestEnvironment.Start.AddSeconds(i)), session.Steps.Select(s => s.Timestamp));
        Assert.Equal(0, clicks.DroppedClickCount);
    }

    [Fact]
    public async Task FullQueue_DropsOldestClicksAndCountsThem()
    {
        var tinySource = new FakeClickSource();
        using var limited = new ClickRecorder(recorder, tinySource, inspector, capture, OwnProcessId, clock, queueCapacity: 4);
        Session session = Start();
        inspector.Block();

        for (int i = 0; i < 20; i++)
        {
            tinySource.Click(ClickAt(250, 130, secondsIn: i));
        }

        inspector.Release();
        await limited.FlushAsync();

        Assert.True(limited.DroppedClickCount > 0);
        Assert.Equal(Enumerable.Range(1, session.StepCount), session.Steps.Select(s => s.StepNumber));
        Assert.Equal(TestEnvironment.Start.AddSeconds(19), session.Steps[^1].Timestamp);
    }

    [Fact]
    public async Task TrayMenuOpen_RemovesTheTaskbarClickThatOpenedIt()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Windows[(1800, 1060)] = Taskbar;

        source.Click(ClickAt(250, 130, secondsIn: 0));
        source.Click(ClickAt(1800, 1060, MouseButton.Right, secondsIn: 9));
        clock.Advance(TimeSpan.FromSeconds(10));
        clicks.DiscardTrayMenuClick();
        await clicks.FlushAsync();

        Assert.Equal(["Notepad"], session.Steps.Select(s => s.ApplicationName));
        Assert.Single(new FileSessionStore().Load(session.Directory).Steps);
    }

    [Fact]
    public async Task TrayMenuOpen_KeepsOlderTaskbarClicksAndOtherSteps()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Windows[(1800, 1060)] = Taskbar;

        source.Click(ClickAt(1800, 1060, secondsIn: 0));   // a real taskbar click, long ago
        source.Click(ClickAt(250, 130, secondsIn: 8));     // the last step is not a tray click
        clock.Advance(TimeSpan.FromSeconds(10));
        clicks.DiscardTrayMenuClick();
        await clicks.FlushAsync();

        Assert.Equal(2, session.StepCount);
    }

    [Fact]
    public void SourceStartFailure_IsReportedAndRecordingContinues()
    {
        source.FailToStart = true;
        Exception? reported = null;
        clicks.SourceFailed += (_, ex) => reported = ex;

        Start();

        Assert.IsType<InvalidOperationException>(reported);
        Assert.Equal(RecordingState.Recording, recorder.State);
    }

    [Fact]
    public void Dispose_StopsAndDisposesSource()
    {
        Start();

        clicks.Dispose();

        Assert.False(source.IsRunning);
        Assert.True(source.IsDisposed);
    }

    [Fact]
    public async Task StepsChanged_IsRaisedForAddedSteps()
    {
        int changes = 0;
        recorder.StepsChanged += (_, _) => Interlocked.Increment(ref changes);
        Start();

        source.Click(ClickAt(1, 1));
        source.Click(ClickAt(2, 2));
        await clicks.FlushAsync();

        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task Capture_IsSavedAsNumberedPngAndLinkedToStep()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Windows[(-1400, 200)] = Calculator;

        source.Click(ClickAt(250, 130));
        source.Click(ClickAt(-1400, 200));
        await clicks.FlushAsync();

        Assert.Equal([Notepad, Calculator], capture.Captured);
        Step first = session.Steps[0];
        Assert.Equal(ScreenshotStatus.Captured, first.ScreenshotStatus);
        Assert.Equal("screenshots/step-001.png", first.ScreenshotPath);
        Assert.Equal((800, 600), (first.ScreenshotWidth, first.ScreenshotHeight));
        Assert.Equal("Fake", first.ScreenshotMethod);
        Assert.Equal("screenshots/step-002.png", session.Steps[1].ScreenshotPath);
        Assert.Equal(FakeWindowCapture.PngFor(Notepad), File.ReadAllBytes(Path.Combine(session.Directory, "screenshots", "step-001.png")));
        Assert.Equal(FakeWindowCapture.PngFor(Calculator), File.ReadAllBytes(Path.Combine(session.Directory, "screenshots", "step-002.png")));
    }

    [Fact]
    public async Task CaptureFailure_StillRecordsStepWithReason()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        capture.FailureReason = "Access is denied.";

        source.Click(ClickAt(250, 130));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal(ScreenshotStatus.Unavailable, step.ScreenshotStatus);
        Assert.Equal("Access is denied.", step.ScreenshotNote);
        Assert.Null(step.ScreenshotPath);
        Assert.Equal("Untitled - Notepad", step.WindowTitle);
        Assert.Equal(RecordingState.Recording, recorder.State);
    }

    [Fact]
    public async Task CaptureException_StillRecordsStep()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        capture.Throw = true;

        source.Click(ClickAt(250, 130));
        source.Click(ClickAt(250, 130));
        await clicks.FlushAsync();

        Assert.Equal(2, session.StepCount);
        Assert.All(session.Steps, s => Assert.Equal(ScreenshotStatus.Unavailable, s.ScreenshotStatus));
    }

    [Fact]
    public async Task ScreenshotWriteFailure_StillRecordsStep()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        store.FailScreenshots = true;

        source.Click(ClickAt(250, 130));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal(ScreenshotStatus.Unavailable, step.ScreenshotStatus);
        Assert.Null(step.ScreenshotPath);
        Assert.Null(step.ScreenshotWidth);
    }

    [Fact]
    public async Task DesktopClick_IsRecordedButNotCaptured()
    {
        Session session = Start();
        inspector.Windows[(5, 5)] = Notepad with { ProcessName = "explorer", ClassName = "Progman", Bounds = new ScreenRect(-1920, 0, 3840, 1080) };

        source.Click(ClickAt(5, 5));
        await clicks.FlushAsync();

        Assert.Empty(capture.Captured);
        Assert.Equal(ScreenshotStatus.Skipped, Assert.Single(session.Steps).ScreenshotStatus);
    }

    [Fact]
    public async Task NoWindowFound_IsMarkedUnavailable()
    {
        Session session = Start();

        source.Click(ClickAt(5, 6));
        await clicks.FlushAsync();

        Assert.Empty(capture.Captured);
        Assert.Equal(ScreenshotStatus.Unavailable, Assert.Single(session.Steps).ScreenshotStatus);
    }

    [Fact]
    public async Task OwnWindows_AreNeverCaptured()
    {
        Start();
        inspector.Windows[(10, 10)] = OwnWindow;

        source.Click(ClickAt(10, 10));
        await clicks.FlushAsync();

        Assert.Empty(capture.Captured);
    }

    [Fact]
    public async Task ClickQueuedBeforePause_WritesNoScreenshot()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Block();
        source.Click(ClickAt(250, 130));
        recorder.Pause();
        inspector.Release();
        await clicks.FlushAsync();

        Assert.Empty(Directory.GetFiles(Path.Combine(session.Directory, "screenshots")));
    }

    [Fact]
    public async Task RemovedTrayClick_DeletesItsScreenshot_AndNextStepReusesNumber()
    {
        Session session = Start();
        inspector.Windows[(250, 130)] = Notepad;
        inspector.Windows[(1800, 1060)] = Taskbar;
        string screenshots = Path.Combine(session.Directory, "screenshots");

        source.Click(ClickAt(250, 130, secondsIn: 0));
        source.Click(ClickAt(1800, 1060, MouseButton.Right, secondsIn: 9));
        clock.Advance(TimeSpan.FromSeconds(10));
        clicks.DiscardTrayMenuClick();
        await clicks.FlushAsync();

        Assert.Equal(["step-001.png"], Directory.GetFiles(screenshots).Select(Path.GetFileName));

        inspector.Windows[(-1400, 200)] = Calculator;
        source.Click(ClickAt(-1400, 200, secondsIn: 11));
        await clicks.FlushAsync();

        Assert.Equal("screenshots/step-002.png", session.Steps[^1].ScreenshotPath);
        Assert.Equal(2, Directory.GetFiles(screenshots).Length);
    }

    private sealed class FakeClickSource : IMouseClickSource
    {
        private Action<MouseClick>? onClick;

        public bool FailToStart { get; set; }

        public bool IsRunning => onClick is not null;

        public bool IsDisposed { get; private set; }

        public void Start(Action<MouseClick> onClick)
        {
            if (FailToStart)
            {
                throw new InvalidOperationException("Simulated hook failure.");
            }

            this.onClick = onClick;
        }

        public void Stop() => onClick = null;

        public void Dispose()
        {
            Stop();
            IsDisposed = true;
        }

        /// <summary>Simulates a click; only delivered while started, like the real hook.</summary>
        public void Click(MouseClick click) => onClick?.Invoke(click);
    }

    private sealed class FakeWindowCapture : IWindowCapture
    {
        public List<WindowInfo> Captured { get; } = [];

        public string? FailureReason { get; set; }

        public bool Throw { get; set; }

        /// <summary>Distinct bytes per window, so tests can tell screenshots apart.</summary>
        public static byte[] PngFor(WindowInfo window) => BitConverter.GetBytes(window.Handle);

        public CaptureResult Capture(WindowInfo window)
        {
            if (Throw)
            {
                throw new InvalidOperationException("Simulated capture crash.");
            }

            if (FailureReason is { } reason)
            {
                return CaptureResult.Failed(reason);
            }

            Captured.Add(window);
            return CaptureResult.Success(new CapturedImage(PngFor(window), window.Bounds.Width, window.Bounds.Height, "Fake"));
        }
    }

    private sealed class FakeWindowInspector : IWindowInspector
    {
        private readonly ManualResetEventSlim gate = new(initialState: true);

        public Dictionary<(int X, int Y), WindowInfo> Windows { get; } = [];

        public bool ThrowOnLookup { get; set; }

        public void Block() => gate.Reset();

        public void Release() => gate.Set();

        public WindowInfo? GetTopLevelWindowAt(int x, int y)
        {
            gate.Wait(TimeSpan.FromSeconds(10));
            if (ThrowOnLookup)
            {
                throw new InvalidOperationException("Simulated lookup failure.");
            }

            return Windows.GetValueOrDefault((x, y));
        }
    }
}
