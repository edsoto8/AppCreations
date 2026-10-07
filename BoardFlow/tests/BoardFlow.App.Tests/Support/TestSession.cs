using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Threading;
using BoardFlow.App.Infrastructure;
using BoardFlow.App.ViewModels;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Data.Repositories;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Serilog;

namespace BoardFlow.Tests.App.Support;

/// <summary>
/// Starts the app exactly as <c>Program</c> does (DI, database initialisation, main view model) against
/// a temporary data folder. <see cref="Restart"/> disposes the session and starts a new one on the same
/// folder, which is how tests prove data survives an application restart.
/// </summary>
public sealed class TestSession : IDisposable
{
    private readonly ILogger _log;

    public TestSession(string? dataDirectory = null)
    {
        DataDirectory = dataDirectory ?? Path.Combine(Path.GetTempPath(), "boardflow-ui-tests", Guid.NewGuid().ToString("N"));
        _log = new LoggerConfiguration().WriteTo.File(Path.Combine(DataDirectory, "logs", "test-.log"), rollingInterval: RollingInterval.Infinite).CreateLogger();
        Session = AppSession.Start(new AppPaths(DataDirectory), _log, Clock);
    }

    public string DataDirectory { get; }

    public FakeClock Clock { get; } = new();

    public AppSession Session { get; private set; }

    public MainViewModel Main => Session.Main ?? throw new InvalidOperationException("Start-up failed: " + Session.Window.Title);

    public BoardViewModel Board => Main.CurrentBoard ?? throw new InvalidOperationException("No board is open.");

    public Window Window => Session.Window;

    public CardRepository Cards => Session.Services.GetRequiredService<CardRepository>();

    public ColumnRepository Columns => Session.Services.GetRequiredService<ColumnRepository>();

    public BoardFlow.Data.Repositories.BoardRepository Boards => Session.Services.GetRequiredService<BoardFlow.Data.Repositories.BoardRepository>();

    public LabelRepository Labels => Session.Services.GetRequiredService<LabelRepository>();

    public DialogViewModel? Dialog => Main.Dialogs.Current;

    /// <summary>Simulates closing and reopening the application on the same data folder.</summary>
    public void Restart()
    {
        CloseWindow();
        Session.Dispose();
        Session = AppSession.Start(new AppPaths(DataDirectory), _log, Clock);
    }

    /// <summary>Shows the main window at the given size and lays it out.</summary>
    public Window Show(double width = 1320, double height = 820)
    {
        Window.Width = width;
        Window.Height = height;
        Window.Show();
        Pump();
        return Window;
    }

    /// <summary>Runs queued dispatcher work and renders a frame so layout and bindings are current.</summary>
    public static void Pump()
    {
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        Dispatcher.UIThread.RunJobs();
    }

    /// <summary>Starts an async command, answers the dialog it opens, and waits for the command to finish.</summary>
    public async Task RunWithDialog(Func<Task> start, Action<DialogViewModel> answer)
    {
        var task = start();
        await WaitFor(() => Dialog is not null || task.IsCompleted);
        Assert.NotNull(Dialog);
        answer(Dialog!);
        await task;
        Pump();
    }

    public static async Task WaitFor(Func<bool> condition, int timeoutMs = 3000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException("Condition was not met in time.");
            }

            Dispatcher.UIThread.RunJobs();
            await Task.Delay(5);
        }
    }

    /// <summary>Saves a PNG of the window when BOARDFLOW_SCREENSHOTS names a folder (used for visual review).</summary>
    public void Screenshot(string name)
    {
        var folder = Environment.GetEnvironmentVariable("BOARDFLOW_SCREENSHOTS");
        if (string.IsNullOrEmpty(folder))
        {
            return;
        }

        Pump();
        Directory.CreateDirectory(folder);
        using var frame = Window.CaptureRenderedFrame();
        frame?.Save(Path.Combine(folder, name + ".png"), Avalonia.Media.Imaging.PngBitmapEncoderOptions.Default);
    }

    public void Dispose()
    {
        CloseWindow();
        Session.Dispose();
        (_log as IDisposable)?.Dispose();
        SqliteConnection.ClearAllPools();
        try
        {
            Directory.Delete(DataDirectory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private void CloseWindow()
    {
        if (Window.IsVisible)
        {
            Window.Close();
            Dispatcher.UIThread.RunJobs();
        }
    }
}
