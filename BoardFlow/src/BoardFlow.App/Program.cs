using Avalonia;
using BoardFlow.App.Infrastructure;
using Serilog;

namespace BoardFlow.App;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var paths = AppPaths.Resolve(args);
        Log.Logger = Logging.Create(paths, verbose: args.Contains("--verbose"));
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Log.Fatal(e.ExceptionObject as Exception, "Unhandled exception (terminating: {IsTerminating})", e.IsTerminating);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error(e.Exception, "Unobserved task exception");
            e.SetObserved();
        };

        try
        {
            Log.Information(
                "BoardFlow {Version} starting on {OS}. Data folder: {DataDirectory}",
                typeof(Program).Assembly.GetName().Version, Environment.OSVersion, paths.DataDirectory);
            BuildAvaloniaApp(paths).StartWithClassicDesktopLifetime(args);
            return 0;
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "BoardFlow terminated unexpectedly");
            return 1;
        }
        finally
        {
            Log.Information("BoardFlow stopped");
            Log.CloseAndFlush();
        }
    }

    /// <summary>Used by the visual designer; the real entry point passes the resolved paths.</summary>
    public static AppBuilder BuildAvaloniaApp() => BuildAvaloniaApp(AppPaths.Resolve([]));

    private static AppBuilder BuildAvaloniaApp(AppPaths paths)
    {
        Avalonia.Logging.Logger.Sink = new SerilogAvaloniaSink();
        return AppBuilder.Configure(() => new App(paths))
            .UsePlatformDetect()
            .WithInterFont();
    }
}
