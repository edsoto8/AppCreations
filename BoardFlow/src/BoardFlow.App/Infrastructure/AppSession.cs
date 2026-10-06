using Avalonia.Controls;
using Avalonia.Threading;
using BoardFlow.App.ViewModels;
using BoardFlow.App.Views;
using BoardFlow.Core;
using BoardFlow.Data;
using BoardFlow.Data.Schema;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

namespace BoardFlow.App.Infrastructure;

/// <summary>
/// One run of the application: the service container, the database check and the first window.
/// Tests create sessions against a temporary data folder exactly as the app does.
/// </summary>
public sealed class AppSession : IDisposable
{
    private readonly Serilog.ILogger _log;
    private readonly DispatcherUnhandledExceptionEventHandler? _unhandled;

    private AppSession(
        ServiceProvider services, Window window, Serilog.ILogger log, DispatcherUnhandledExceptionEventHandler? unhandled)
    {
        Services = services;
        Window = window;
        _log = log;
        _unhandled = unhandled;
    }

    public ServiceProvider Services { get; }

    public Window Window { get; }

    /// <summary>The main view model, or null when start-up failed and an error window is shown instead.</summary>
    public MainViewModel? Main => (Window as MainWindow)?.DataContext as MainViewModel;

    public static AppSession Start(AppPaths paths, Serilog.ILogger log, IClock? clock = null)
    {
        var services = AppServices.Build(paths, log, clock);
        try
        {
            services.GetRequiredService<DatabaseInitializer>().Initialize();
        }
        catch (Exception ex)
        {
            log.Error(ex, "Start-up stopped: the database could not be used");
            var message = ex is PersistenceException ? ex.Message : $"Unexpected error while opening the database: {ex.Message}";
            return new AppSession(services, new StartupErrorWindow(message, paths), log, null);
        }

        var main = services.GetRequiredService<MainViewModel>();
        var notifier = services.GetRequiredService<Notifier>();
        DispatcherUnhandledExceptionEventHandler unhandled = (_, e) =>
        {
            // Keep the app alive: every change is already committed or rolled back in SQLite.
            log.Error(e.Exception, "Unhandled exception on the UI thread");
            notifier.Error("Something went wrong. Your saved data is safe; details are in the log file.");
            e.Handled = true;
        };
        Dispatcher.UIThread.UnhandledException += unhandled;

        main.Initialize();
        log.Information("Main window ready");
        return new AppSession(services, new MainWindow { DataContext = main }, log, unhandled);
    }

    public void Dispose()
    {
        if (_unhandled is not null)
        {
            Dispatcher.UIThread.UnhandledException -= _unhandled;
        }

        Services.Dispose();
        SqliteConnection.ClearAllPools();
        _log.Information("Session closed");
    }
}
