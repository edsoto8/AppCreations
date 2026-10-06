using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Automation;
using StepRecorder.Core.Capture;
using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Core.Recording;

/// <summary>
/// The recording state machine: Idle → Recording ⇄ Paused → Idle. Only one session can exist at a time.
/// The session is saved on every transition, so a crash loses at most the in-flight change.
/// Thread-safe: later milestones feed it from the input thread.
/// </summary>
public sealed class Recorder(
    ISessionStore store,
    SessionEnvironment environment,
    TimeProvider? timeProvider = null,
    ILogger? logger = null)
{
    private readonly object gate = new();
    private readonly TimeProvider time = timeProvider ?? TimeProvider.System;
    private readonly ILogger logger = logger ?? NullLogger.Instance;

    private RecordingState state = RecordingState.Idle;
    private Session? current;
    private DateTimeOffset? pausedAt;
    private TimeSpan pausedTotal;

    /// <summary>
    /// Raised after every state change, on the thread that caused it and outside the recorder's lock.
    /// </summary>
    public event EventHandler<RecordingStateChangedEventArgs>? StateChanged;

    /// <summary>Raised after steps are added or removed, on the thread that changed them.</summary>
    public event EventHandler? StepsChanged;

    public RecordingState State
    {
        get
        {
            lock (gate)
            {
                return state;
            }
        }
    }

    /// <summary>The session being recorded, or null when idle.</summary>
    public Session? CurrentSession
    {
        get
        {
            lock (gate)
            {
                return current;
            }
        }
    }

    /// <summary>The most recent session stopped by this recorder instance.</summary>
    public Session? LastSession { get; private set; }

    /// <exception cref="InvalidOperationException">A session is already recording or paused.</exception>
    /// <exception cref="IOException">The session folder or file could not be created.</exception>
    public Session Start(
        string recordingsDirectory,
        string? name,
        RecordingSettings settings,
        ScreenshotSettings? screenshotSettings = null)
    {
        Session session;
        lock (gate)
        {
            if (state != RecordingState.Idle)
            {
                throw new InvalidOperationException("A recording is already in progress.");
            }

            DateTimeOffset startedAt = time.GetLocalNow();
            string displayName = string.IsNullOrWhiteSpace(name) ? StorageSettings.DefaultName : name.Trim();

            session = new Session
            {
                Name = displayName,
                Status = SessionStatus.Recording,
                StartedAt = startedAt,
                ApplicationVersion = environment.ApplicationVersion,
                OperatingSystem = environment.OperatingSystem,
                RecordingSettingsSnapshot = settings,
                ScreenshotSettingsSnapshot = (screenshotSettings ?? new ScreenshotSettings()).Clamped(),
                Directory = store.CreateSessionDirectory(recordingsDirectory, startedAt, displayName),
            };
            store.Save(session);

            current = session;
            pausedAt = null;
            pausedTotal = TimeSpan.Zero;
            state = RecordingState.Recording;
        }

        logger.LogInformation("Recording started: {SessionId} in {Directory}", session.SessionId, session.Directory);
        Raise(RecordingState.Idle, RecordingState.Recording);
        return session;
    }

    /// <exception cref="InvalidOperationException">Not currently recording.</exception>
    public void Pause()
    {
        lock (gate)
        {
            Require(RecordingState.Recording, nameof(Pause));
            pausedAt = time.GetLocalNow();
            current!.Status = SessionStatus.Paused;
            state = RecordingState.Paused;
            TrySave(current);
        }

        logger.LogInformation("Recording paused");
        Raise(RecordingState.Recording, RecordingState.Paused);
    }

    /// <exception cref="InvalidOperationException">Not currently paused.</exception>
    public void Resume()
    {
        lock (gate)
        {
            Require(RecordingState.Paused, nameof(Resume));
            pausedTotal += time.GetLocalNow() - pausedAt!.Value;
            pausedAt = null;
            current!.Status = SessionStatus.Recording;
            state = RecordingState.Recording;
            TrySave(current);
        }

        logger.LogInformation("Recording resumed");
        Raise(RecordingState.Paused, RecordingState.Recording);
    }

    /// <summary>
    /// Finalizes and saves the session. The recorder is idle afterwards even if saving fails.
    /// </summary>
    /// <exception cref="InvalidOperationException">No session is recording or paused.</exception>
    /// <exception cref="IOException">The final save failed; the last incremental save remains on disk.</exception>
    public Session Stop()
    {
        Session session;
        RecordingState previous;
        lock (gate)
        {
            if (state == RecordingState.Idle)
            {
                throw new InvalidOperationException("No recording is in progress.");
            }

            previous = state;
            DateTimeOffset endedAt = time.GetLocalNow();
            if (pausedAt is { } pauseStart)
            {
                pausedTotal += endedAt - pauseStart;
            }

            session = current!;
            session.EndedAt = endedAt;
            session.Duration = endedAt - session.StartedAt;
            session.ActiveDuration = session.Duration - pausedTotal;
            session.Status = SessionStatus.Completed;

            current = null;
            pausedAt = null;
            state = RecordingState.Idle;
            LastSession = session;
        }

        try
        {
            store.Save(session);
            logger.LogInformation("Recording stopped: {SessionId}, {StepCount} steps", session.SessionId, session.StepCount);
        }
        finally
        {
            Raise(previous, RecordingState.Idle);
        }

        return session;
    }

    /// <summary>
    /// Adds a click as the next step, writes its screenshot as <c>screenshots/step-NNN.png</c> and saves
    /// the session. Clicks that arrive while paused or idle (for example, still queued when the user
    /// paused) are dropped. A screenshot that cannot be written leaves the step without one.
    /// </summary>
    /// <returns>The new step, or null when the click was dropped.</returns>
    public Step? AddStep(MouseClick click, WindowInfo? window, StepScreenshot? screenshot = null, UiElementInfo? element = null)
    {
        Step step;
        lock (gate)
        {
            if (state != RecordingState.Recording)
            {
                return null;
            }

            step = StepFactory.FromClick(current!.Steps.Count + 1, click, window, element);
            if (screenshot is not null)
            {
                AttachScreenshot(current, step, screenshot);
            }

            current.Steps.Add(step);
            TrySave(current);
        }

        StepsChanged?.Invoke(this, EventArgs.Empty);
        return step;
    }

    /// <summary>
    /// Counts another click (double/triple-click) on the last step instead of adding a new one.
    /// </summary>
    /// <returns>False when <paramref name="stepNumber"/> is no longer the last step or not recording.</returns>
    public bool AddClickToLastStep(int stepNumber)
    {
        lock (gate)
        {
            if (state != RecordingState.Recording || current!.Steps.Count == 0 || current.Steps[^1].StepNumber != stepNumber)
            {
                return false;
            }

            Step step = current.Steps[^1];
            step.ClickCount = (step.ClickCount ?? 1) + 1;
            TrySave(current);
        }

        StepsChanged?.Invoke(this, EventArgs.Empty);
        return true;
    }

    /// <summary>
    /// Removes steps from the end of the session while <paramref name="shouldRemove"/> matches them, then
    /// saves. Step numbers stay contiguous because only trailing steps are removed.
    /// </summary>
    /// <returns>How many steps were removed.</returns>
    public int RemoveTrailingSteps(Func<Step, bool> shouldRemove)
    {
        int removed = 0;
        lock (gate)
        {
            if (current is null)
            {
                return 0;
            }

            List<Step> steps = current.Steps;
            while (steps.Count > 0 && shouldRemove(steps[^1]))
            {
                DeleteScreenshot(current, steps[^1]);
                steps.RemoveAt(steps.Count - 1);
                removed++;
            }

            if (removed > 0)
            {
                TrySave(current);
            }
        }

        if (removed > 0)
        {
            StepsChanged?.Invoke(this, EventArgs.Empty);
        }

        return removed;
    }

    private void AttachScreenshot(Session session, Step step, StepScreenshot screenshot)
    {
        step.ScreenshotStatus = screenshot.Status;
        step.ScreenshotNote = screenshot.Note;
        if (screenshot.Image is not { } image)
        {
            return;
        }

        try
        {
            step.ScreenshotPath = store.SaveScreenshot(session, step.StepNumber, image.Data, image.Format);
            step.ScreenshotWidth = image.Width;
            step.ScreenshotHeight = image.Height;
            step.ScreenshotMethod = image.Method;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Could not save the screenshot for step {StepNumber}", step.StepNumber);
            step.ScreenshotStatus = ScreenshotStatus.Unavailable;
            step.ScreenshotNote = "The screenshot could not be saved to disk.";
        }
    }

    private void DeleteScreenshot(Session session, Step step)
    {
        if (step.ScreenshotPath is null)
        {
            return;
        }

        try
        {
            store.DeleteScreenshot(session, step.ScreenshotPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // The next step with this number overwrites the file anyway.
            logger.LogWarning(ex, "Could not delete screenshot {Path}", step.ScreenshotPath);
        }
    }

    private void Require(RecordingState required, string operation)
    {
        if (state != required)
        {
            throw new InvalidOperationException($"Cannot {operation.ToLowerInvariant()} while {state.ToString().ToLowerInvariant()}.");
        }
    }

    // A failed incremental save must not end the recording; the next save will try again.
    private void TrySave(Session session)
    {
        try
        {
            store.Save(session);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Could not save session {SessionId}", session.SessionId);
        }
    }

    private void Raise(RecordingState previous, RecordingState next) =>
        StateChanged?.Invoke(this, new RecordingStateChangedEventArgs(previous, next));
}
