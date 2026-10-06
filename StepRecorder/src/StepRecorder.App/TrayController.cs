using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Extensions.Logging;
using StepRecorder.Core.Input;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Reporting;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;
using StepRecorder.Windows;
using Forms = System.Windows.Forms;

namespace StepRecorder.App;

/// <summary>
/// Owns the tray icon and its menu, and turns menu commands into <see cref="Recorder"/> calls.
/// Everything here runs on the WPF UI thread.
/// </summary>
internal sealed class TrayController : IDisposable
{
    private const string AppName = "Step Recorder";

    // NotifyIcon.Text throws above 127 characters.
    private const int MaxTooltipLength = 127;

    private readonly Application application;
    private readonly Recorder recorder;
    private readonly ClickRecorder clickRecorder;
    private readonly ISessionStore sessionStore;
    private readonly JsonSettingsStore settingsStore;
    private readonly ILogger logger;
    private readonly ReportGenerator reportGenerator;

    private readonly TrayIcons icons = new();
    private readonly Forms.NotifyIcon notifyIcon;
    private readonly Forms.ContextMenuStrip menu;
    private readonly Forms.ToolStripMenuItem statusItem;
    private readonly Forms.ToolStripMenuItem startItem;
    private readonly Forms.ToolStripMenuItem pauseItem;
    private readonly Forms.ToolStripMenuItem stopItem;

    private RecorderSettings settings;
    private SettingsWindow? settingsWindow;
    private string? lastOpenTarget;

    public TrayController(
        Application application,
        Recorder recorder,
        ClickRecorder clickRecorder,
        ISessionStore sessionStore,
        JsonSettingsStore settingsStore,
        ILogger logger)
    {
        this.application = application;
        this.recorder = recorder;
        this.clickRecorder = clickRecorder;
        this.sessionStore = sessionStore;
        this.settingsStore = settingsStore;
        this.logger = logger;
        reportGenerator = new ReportGenerator(new ScreenshotAnnotator(), logger);
        settings = settingsStore.Load();

        statusItem = new Forms.ToolStripMenuItem { Enabled = false };
        startItem = new Forms.ToolStripMenuItem("&Start Recording", null, (_, _) => StartRecording());
        pauseItem = new Forms.ToolStripMenuItem("&Pause Recording", null, (_, _) => TogglePause());
        stopItem = new Forms.ToolStripMenuItem("S&top Recording", null, (_, _) => StopRecording());

        menu = new Forms.ContextMenuStrip();

        // Opening the menu needs a click on our tray icon, which belongs to Explorer's taskbar and is
        // therefore recorded. Remove it so reports don't start or end with "clicked the taskbar".
        menu.Opening += (_, _) => clickRecorder.DiscardTrayMenuClick();
        menu.Items.AddRange(
        [
            statusItem,
            new Forms.ToolStripSeparator(),
            startItem,
            pauseItem,
            stopItem,
            new Forms.ToolStripSeparator(),
            new Forms.ToolStripMenuItem("&Open Last Recording", null, (_, _) => OpenLastRecording()),
            new Forms.ToolStripMenuItem("Se&ttings…", null, (_, _) => ShowSettings()),
            new Forms.ToolStripSeparator(),
            new Forms.ToolStripMenuItem("E&xit", null, (_, _) => RequestExit()),
        ]);

        notifyIcon = new Forms.NotifyIcon { ContextMenuStrip = menu };
        notifyIcon.BalloonTipClicked += (_, _) => Open(lastOpenTarget);

        recorder.StateChanged += OnRecorderStateChanged;
        recorder.StepsChanged += OnRecorderStepsChanged;
        clickRecorder.SourceFailed += OnClickSourceFailed;
        UpdateUi();
        notifyIcon.Visible = true;
    }

    /// <summary>
    /// Stops and saves any recording without asking. Used when Windows is logging off or shutting down.
    /// </summary>
    public void FinalizeRecording()
    {
        if (recorder.State == RecordingState.Idle)
        {
            return;
        }

        try
        {
            recorder.Stop();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Final save failed during shutdown; the last incremental save remains");
        }

        if (recorder.LastSession is { } session)
        {
            WriteReports(session);
        }
    }

    public void Dispose()
    {
        recorder.StateChanged -= OnRecorderStateChanged;
        recorder.StepsChanged -= OnRecorderStepsChanged;
        clickRecorder.SourceFailed -= OnClickSourceFailed;
        settingsWindow?.Close();
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        menu.Dispose();
        icons.Dispose();
    }

    private void StartRecording()
    {
        string directory = AppPaths.RecordingsDirectory(settings);
        try
        {
            recorder.Start(directory, settings.Storage.DefaultSessionName, settings.Recording, settings.Screenshot);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Could not start a recording in {Directory}", directory);
            ShowError($"Could not create the recording folder in:\n{directory}\n\n{ex.Message}\n\nChoose another folder in Settings.");
        }
    }

    private void TogglePause()
    {
        if (recorder.State == RecordingState.Recording)
        {
            recorder.Pause();
        }
        else if (recorder.State == RecordingState.Paused)
        {
            recorder.Resume();
        }
    }

    private void StopRecording()
    {
        if (recorder.State == RecordingState.Idle)
        {
            return;
        }

        // Let queued clicks finish first, including the removal of the tray click that opened this menu.
        // Safe to wait here: the click consumer never blocks on the UI thread.
        if (!clickRecorder.FlushAsync().Wait(TimeSpan.FromSeconds(2)))
        {
            logger.LogWarning("Click queue still busy at Stop; stopping anyway");
        }

        Session? session = recorder.CurrentSession;
        try
        {
            recorder.Stop();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Final save failed for {Directory}", session?.Directory);
            ShowError($"The recording stopped, but its final details could not be saved.\n\n{ex.Message}\n\nEverything up to the last change is still in:\n{session?.Directory}");
        }

        // The report is built from the in-memory session, so it is written even if the final save failed.
        session = recorder.LastSession;
        if (session is null)
        {
            return;
        }

        string? report = WriteReports(session);
        lastOpenTarget = report ?? session.Directory;
        notifyIcon.ShowBalloonTip(
            3000,
            "Recording saved",
            report is null
                ? $"{session.Name}: the report could not be written. Click here to open the folder."
                : $"{session.Name}: {ReportText.Steps(session.StepCount)}. Click here to open the report.",
            report is null ? Forms.ToolTipIcon.Warning : Forms.ToolTipIcon.Info);
    }

    /// <returns>The report to open (HTML when enabled), or null when none could be written.</returns>
    private string? WriteReports(Session session)
    {
        try
        {
            return reportGenerator.Generate(session, settings).FirstOrDefault();
        }
        catch (Exception ex)
        {
            // A report failure must never lose the recording; session.json and the PNGs are already on disk.
            logger.LogError(ex, "Report generation failed for {Directory}", session.Directory);
            return null;
        }
    }

    private void OpenLastRecording()
    {
        Session? session = recorder.LastSession;
        if (session is null || !Directory.Exists(session.Directory))
        {
            session = sessionStore.FindMostRecent(AppPaths.RecordingsDirectory(settings));
        }

        if (session is null)
        {
            MessageBox.Show("There are no recordings yet.", AppName, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        Open(FindOrCreateReport(session) ?? session.Directory);
    }

    /// <summary>
    /// The session's existing report, or a freshly written one. Interrupted sessions (the app crashed)
    /// have no report until they are opened here.
    /// </summary>
    private string? FindOrCreateReport(Session session)
    {
        foreach (IReportExporter exporter in ReportGenerator.ExportersFor(settings.Reports))
        {
            string path = Path.Combine(session.Directory, exporter.FileName);
            if (File.Exists(path))
            {
                return path;
            }
        }

        return WriteReports(session);
    }

    private void ShowSettings()
    {
        if (settingsWindow is not null)
        {
            settingsWindow.Activate();
            return;
        }

        settingsWindow = new SettingsWindow(settings, AppPaths.DefaultRecordingsDirectory, SaveSettings);
        settingsWindow.Closed += (_, _) => settingsWindow = null;
        settingsWindow.Show();
        settingsWindow.Activate();
    }

    /// <returns>An error message, or null when the settings were saved.</returns>
    private string? SaveSettings(RecorderSettings updated)
    {
        try
        {
            settingsStore.Save(updated);
            settings = updated;
            logger.LogInformation("Settings saved");
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Could not save settings to {Path}", settingsStore.FilePath);
            return $"Could not save settings: {ex.Message}";
        }
    }

    private void RequestExit()
    {
        if (recorder.State != RecordingState.Idle)
        {
            MessageBoxResult answer = MessageBox.Show(
                "A recording is in progress.\n\nStop and save it, then exit?",
                AppName,
                MessageBoxButton.YesNo,
                MessageBoxImage.Question,
                MessageBoxResult.No);

            if (answer != MessageBoxResult.Yes)
            {
                return;
            }

            // A failed final save has already been reported; the last incremental save is on disk.
            StopRecording();
        }

        application.Shutdown();
    }

    private void OnRecorderStateChanged(object? sender, RecordingStateChangedEventArgs e) => OnUiThread(UpdateUi);

    // Raised on the click-processing thread.
    private void OnRecorderStepsChanged(object? sender, EventArgs e) => OnUiThread(UpdateUi);

    private void OnClickSourceFailed(object? sender, Exception e) => OnUiThread(() => ShowError(
        $"Step Recorder could not start watching mouse clicks, so this recording will not capture any steps.\n\n{e.Message}"));

    private void OnUiThread(Action action)
    {
        if (application.Dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            application.Dispatcher.InvokeAsync(action);
        }
    }

    private void UpdateUi()
    {
        RecordingState state = recorder.State;
        Session? session = recorder.CurrentSession;
        string steps = session?.StepCount == 1 ? "1 step" : $"{session?.StepCount} steps";

        string status = state switch
        {
            RecordingState.Recording => $"Recording: {session?.Name} ({steps})",
            RecordingState.Paused => $"Paused: {session?.Name} ({steps})",
            _ => "Not recording",
        };

        statusItem.Text = status;
        startItem.Enabled = state == RecordingState.Idle;
        pauseItem.Enabled = state != RecordingState.Idle;
        pauseItem.Text = state == RecordingState.Paused ? "&Resume Recording" : "&Pause Recording";
        stopItem.Enabled = state != RecordingState.Idle;

        notifyIcon.Icon = icons.For(state);
        string tooltip = $"{AppName} – {status}";
        notifyIcon.Text = tooltip.Length > MaxTooltipLength ? tooltip[..(MaxTooltipLength - 1)] + "…" : tooltip;
    }

    /// <summary>Opens a report in the default browser/editor, or a folder in Explorer.</summary>
    private void Open(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            logger.LogError(ex, "Could not open {Path}", path);
            ShowError($"Could not open:\n{path}\n\n{ex.Message}");
        }
    }

    private static void ShowError(string message) =>
        MessageBox.Show(message, AppName, MessageBoxButton.OK, MessageBoxImage.Warning);
}
