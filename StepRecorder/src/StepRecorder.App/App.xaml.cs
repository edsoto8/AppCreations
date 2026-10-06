using System.Threading;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Extensions.Logging;
using StepRecorder.Core.Input;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;
using StepRecorder.Windows;

namespace StepRecorder.App;

/// <summary>
/// Entry point. There is no main window: the app lives in the tray until Exit or Windows shutdown.
/// </summary>
public partial class App : Application
{
    // "Local\" scopes the mutex to the signed-in Windows session.
    private const string SingleInstanceMutexName = @"Local\StepRecorder-6f1c2a8e-single-instance";

    private Mutex? singleInstance;
    private FileLoggerProvider? logging;
    private ILogger? logger;
    private TrayController? tray;
    private ClickRecorder? clickRecorder;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        singleInstance = new Mutex(initiallyOwned: true, SingleInstanceMutexName, out bool createdNew);
        if (!createdNew)
        {
            singleInstance.Dispose();
            singleInstance = null;
            MessageBox.Show(
                "Step Recorder is already running. Look for its icon in the notification area of the taskbar.",
                "Step Recorder",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        logging = new FileLoggerProvider(AppPaths.LogsDirectory);
        logger = logging.CreateLogger("StepRecorder.App");
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            logger.LogCritical(args.ExceptionObject as Exception, "Unhandled exception");

        var settingsStore = new JsonSettingsStore(AppPaths.SettingsFile, logging.CreateLogger(nameof(JsonSettingsStore)));
        var sessionStore = new FileSessionStore(logging.CreateLogger(nameof(FileSessionStore)));
        var recorder = new Recorder(sessionStore, AppPaths.SessionEnvironment, logger: logging.CreateLogger(nameof(Recorder)));

        clickRecorder = new ClickRecorder(
            recorder,
            new LowLevelMouseHook(),
            new Win32WindowInspector(),
            new Win32WindowCapture(),
            Environment.ProcessId,
            logger: logging.CreateLogger(nameof(ClickRecorder)));

        tray = new TrayController(this, recorder, clickRecorder, sessionStore, settingsStore, logger);
        logger.LogInformation("Step Recorder {Version} started on {OperatingSystem}", AppPaths.Version, AppPaths.SessionEnvironment.OperatingSystem);
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        logger?.LogInformation("Windows session ending ({Reason}); saving any recording", e.ReasonSessionEnding);
        tray?.FinalizeRecording();
        base.OnSessionEnding(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        // Exit and session-end have already stopped any recording; this removes the hook and drains queued clicks.
        tray?.Dispose();
        clickRecorder?.Dispose();
        logger?.LogInformation("Step Recorder exited");
        logging?.Dispose();

        if (singleInstance is not null)
        {
            singleInstance.ReleaseMutex();
            singleInstance.Dispose();
        }

        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // The process is going down. Every state change is already on disk, so the session can be
        // recovered; remove the tray icon so no dead icon is left behind.
        logger?.LogCritical(e.Exception, "Unhandled UI exception; exiting");
        tray?.Dispose();
        tray = null;
        MessageBox.Show(
            $"Step Recorder hit an unexpected error and has to close.\n\nRecordings are saved up to the last change. Details are in the log:\n{logging?.FilePath}",
            "Step Recorder",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
    }
}
