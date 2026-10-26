using System.Diagnostics;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using MetroSim.App.Game;
using MetroSim.App.Services;

namespace MetroSim.App;

public sealed partial class App : Application
{
    private readonly AppOptions _options;
    private AppHost? _host;

    /// <summary>Used by the XAML designer and the headless test platform.</summary>
    public App()
        : this(new AppOptions())
    {
    }

    public App(AppOptions options) => _options = options;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            AppHost? host = null;
            host = AppHost.Create(_options, new StorageFileDialogs(() => host?.Window));
            _host = host;
            desktop.MainWindow = host.Window;
            desktop.Exit += (_, _) => _host?.Dispose();
            if (_options.ExitAfterSeconds is { } seconds)
            {
                ScheduleExit(desktop, host, seconds);
            }
        }

        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>--exit-after: measure the real window's frame rate for a while, print it, then quit.</summary>
    private static void ScheduleExit(IClassicDesktopStyleApplicationLifetime desktop, AppHost host, double seconds)
    {
        long startFrames = 0;
        int startGen0 = 0;
        int startGen2 = 0;
        var watch = new Stopwatch();
        host.Window.Opened += (_, _) =>
        {
            // Skip the first second (window mapping, first chunk paint) so the figure is steady-state.
            DispatcherTimer.RunOnce(() =>
            {
                startFrames = host.Window.Map.Renderer.Stats.Frames;
                startGen0 = GC.CollectionCount(0);
                startGen2 = GC.CollectionCount(2);
                watch.Start();
                DispatcherTimer.RunOnce(() =>
                {
                    var stats = host.Window.Map.Renderer.Stats;
                    double elapsed = watch.Elapsed.TotalSeconds;
                    long frames = stats.Frames - startFrames;
                    var (avg, max) = stats.FrameMilliseconds;
                    var report = host.Window.ViewModel;
                    Console.WriteLine(
                        $"metrosim window: {frames} frames in {elapsed:0.00} s = {frames / elapsed:0.0} FPS; " +
                        $"map draw {avg:0.00} ms avg / {max:0.00} ms max; snapshot {stats.SnapshotMilliseconds:0.00} ms; " +
                        $"sim {host.Session.Runner.MeasuredTicksPerSecond:0} ticks/s; vehicles drawn {stats.VisibleVehicles}; " +
                        $"population {report.PopulationText}; {report.DateText}; " +
                        $"managed heap {GC.GetTotalMemory(false) >> 20} MB; GCs while measuring: {GC.CollectionCount(0) - startGen0} gen0, {GC.CollectionCount(2) - startGen2} gen2");
                    desktop.Shutdown();
                }, TimeSpan.FromSeconds(seconds));
            }, TimeSpan.FromSeconds(1));
        };
    }
}
