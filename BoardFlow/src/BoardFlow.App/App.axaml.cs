using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using BoardFlow.App.Infrastructure;

namespace BoardFlow.App;

public sealed partial class App : Application
{
    private readonly AppPaths _paths;
    private AppSession? _session;

    /// <summary>Used by the XAML designer.</summary>
    public App()
        : this(AppPaths.Resolve([]))
    {
    }

    public App(AppPaths paths) => _paths = paths;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _session = AppSession.Start(_paths, Serilog.Log.Logger);
            desktop.MainWindow = _session.Window;
            desktop.Exit += (_, _) => _session.Dispose();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
