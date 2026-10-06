using System.Diagnostics;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Capture;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Input;

/// <summary>
/// Turns global clicks into steps. The click source runs only while the recorder is recording, so
/// nothing is observed while idle or paused. Clicks go through a bounded queue to a single consumer,
/// which looks up the window, captures it and adds the step. The input thread therefore never waits on
/// window lookup, capture or disk I/O, and steps keep click order.
/// </summary>
public sealed class ClickRecorder : IDisposable
{
    public const int DefaultQueueCapacity = 256;

    /// <summary>Captures slower than this are logged, to find windows that delay later screenshots (ADR 0003).</summary>
    public static readonly TimeSpan SlowCaptureThreshold = TimeSpan.FromMilliseconds(250);

    /// <summary>How far back a tray-menu open looks for the taskbar click that opened it.</summary>
    public static readonly TimeSpan TrayClickWindow = TimeSpan.FromSeconds(3);

    private readonly Recorder recorder;
    private readonly IMouseClickSource source;
    private readonly IWindowInspector inspector;
    private readonly IWindowCapture capture;
    private readonly int ownProcessId;
    private readonly TimeProvider time;
    private readonly ILogger logger;
    private readonly Channel<Work> queue;
    private readonly Task consumer;
    private long droppedClicks;

    // Consumer-thread only: the last click that produced or extended a step, for double-click merging.
    private (MouseClick Click, long? Window, int StepNumber)? lastRecorded;

    public ClickRecorder(
        Recorder recorder,
        IMouseClickSource source,
        IWindowInspector inspector,
        IWindowCapture capture,
        int ownProcessId,
        TimeProvider? timeProvider = null,
        ILogger? logger = null,
        int queueCapacity = DefaultQueueCapacity)
    {
        this.recorder = recorder;
        this.source = source;
        this.inspector = inspector;
        this.capture = capture;
        this.ownProcessId = ownProcessId;
        time = timeProvider ?? TimeProvider.System;
        this.logger = logger ?? NullLogger.Instance;

        queue = Channel.CreateBounded<Work>(
            new BoundedChannelOptions(queueCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
            },
            OnDropped);
        consumer = Task.Run(ConsumeAsync);

        recorder.StateChanged += OnStateChanged;
    }

    /// <summary>
    /// Raised when the click source cannot start. Recording carries on, but without clicks.
    /// Raised on the thread that changed the recorder state.
    /// </summary>
    public event EventHandler<Exception>? SourceFailed;

    /// <summary>Clicks thrown away because the queue was full.</summary>
    public long DroppedClickCount => Interlocked.Read(ref droppedClicks);

    /// <summary>
    /// Call when the recorder's own tray menu opens. Removes the taskbar/tray click that opened it from
    /// the end of the session. It is queued behind that click, so it runs after the click is processed.
    /// </summary>
    public void DiscardTrayMenuClick() => queue.Writer.TryWrite(new DiscardTrayClicks(time.GetLocalNow()));

    /// <summary>Completes once every click queued so far has been processed.</summary>
    public Task FlushAsync()
    {
        var flush = new Flush(new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        if (!queue.Writer.TryWrite(flush))
        {
            flush.Done.TrySetResult();
        }

        return flush.Done.Task;
    }

    public void Dispose()
    {
        recorder.StateChanged -= OnStateChanged;
        source.Stop();
        queue.Writer.TryComplete();
        if (!consumer.Wait(TimeSpan.FromSeconds(5)))
        {
            logger.LogWarning("Click queue did not drain within 5 seconds of shutdown");
        }

        source.Dispose();
    }

    private void OnStateChanged(object? sender, RecordingStateChangedEventArgs e)
    {
        if (e.Current != RecordingState.Recording)
        {
            source.Stop();
            return;
        }

        try
        {
            source.Start(OnClick);
        }
        catch (InvalidOperationException ex)
        {
            logger.LogError(ex, "Global click monitoring could not start");
            SourceFailed?.Invoke(this, ex);
        }
    }

    // Runs on the input thread: queue only, never block.
    private void OnClick(MouseClick click) => queue.Writer.TryWrite(new Click(click));

    private void OnDropped(Work work)
    {
        switch (work)
        {
            case Click:
                long total = Interlocked.Increment(ref droppedClicks);
                if (total == 1 || total % 100 == 0)
                {
                    logger.LogWarning("Click queue full; {Count} clicks dropped so far", total);
                }

                break;
            case Flush flush:
                flush.Done.TrySetResult();
                break;
        }
    }

    private async Task ConsumeAsync()
    {
        await foreach (Work work in queue.Reader.ReadAllAsync().ConfigureAwait(false))
        {
            try
            {
                switch (work)
                {
                    case Click click:
                        Process(click.Value);
                        break;
                    case DiscardTrayClicks discard:
                        DiscardTrayClicksBefore(discard.RequestedAt);
                        break;
                    case Flush flush:
                        flush.Done.TrySetResult();
                        break;
                }
            }
            catch (Exception ex)
            {
                // One bad click must never stop the recording.
                logger.LogError(ex, "Failed to process {Work}", work.GetType().Name);
            }
        }
    }

    private void Process(MouseClick click)
    {
        Session? session = recorder.CurrentSession;
        if (session is null || !ShouldCapture(click.Button, session))
        {
            return;
        }

        WindowInfo? window = null;
        try
        {
            window = inspector.GetTopLevelWindowAt(click.X, click.Y);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Window lookup failed at ({X}, {Y}); recording the click without window details", click.X, click.Y);
        }

        if (window?.ProcessId == ownProcessId)
        {
            return;
        }

        // A click queued just before Pause still gets here; don't spend time capturing it.
        if (recorder.State != RecordingState.Recording)
        {
            return;
        }

        // The second click of a double-click adds nothing new to document, and its screenshot would show
        // the result of the first click. Count it on the existing step instead.
        if (session.RecordingSettingsSnapshot.MergeDoubleClicks
            && lastRecorded is { } last
            && RepeatClickDetector.IsRepeat(last.Click, last.Window, click, window?.Handle)
            && recorder.AddClickToLastStep(last.StepNumber))
        {
            lastRecorded = last with { Click = click };
            return;
        }

        Step? step = recorder.AddStep(click, window, CaptureWindow(window, session.ScreenshotSettingsSnapshot));
        lastRecorded = step is null ? null : (click, window?.Handle, step.StepNumber);
    }

    private StepScreenshot CaptureWindow(WindowInfo? window, ScreenshotSettings settings)
    {
        if (window is null)
        {
            return StepScreenshot.Unavailable("No window was found at the click position.");
        }

        if (ShellWindows.IsDesktop(window.ClassName))
        {
            return StepScreenshot.Skipped("Clicks on the desktop are not captured.");
        }

        try
        {
            long started = Stopwatch.GetTimestamp();
            CaptureResult result = capture.Capture(window, settings);
            TimeSpan elapsed = Stopwatch.GetElapsedTime(started);
            if (elapsed > SlowCaptureThreshold)
            {
                logger.LogWarning(
                    "Slow capture: {Milliseconds} ms for {ProcessName} ({Width}x{Height})",
                    (int)elapsed.TotalMilliseconds,
                    window.ProcessName,
                    window.Bounds.Width,
                    window.Bounds.Height);
            }

            if (result.Image is { } image)
            {
                return StepScreenshot.Captured(image);
            }

            string reason = result.FailureReason ?? "The window could not be captured.";
            logger.LogWarning("Screenshot unavailable for {ProcessName}: {Reason}", window.ProcessName, reason);
            return StepScreenshot.Unavailable(reason);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Screenshot failed for {ProcessName}", window.ProcessName);
            return StepScreenshot.Unavailable("The window could not be captured.");
        }
    }

    private static bool ShouldCapture(MouseButton button, Session session) => button switch
    {
        MouseButton.Left => session.RecordingSettingsSnapshot.CaptureLeftClick,
        MouseButton.Right => session.RecordingSettingsSnapshot.CaptureRightClick,
        _ => false,
    };

    private void DiscardTrayClicksBefore(DateTimeOffset requestedAt)
    {
        DateTimeOffset cutoff = requestedAt - TrayClickWindow;
        int removed = recorder.RemoveTrailingSteps(
            step => ShellWindows.IsTaskbarOrTray(step.WindowClassName) && step.Timestamp >= cutoff);

        if (removed > 0)
        {
            logger.LogInformation("Removed {Count} tray click(s) that opened the recorder menu", removed);
        }
    }

    private abstract record Work;

    private sealed record Click(MouseClick Value) : Work;

    private sealed record DiscardTrayClicks(DateTimeOffset RequestedAt) : Work;

    private sealed record Flush(TaskCompletionSource Done) : Work;
}
