using MetroSim.App.Game;
using MetroSim.App.Services;
using MetroSim.App.Rendering;
using MetroSim.App.ViewModels;
using MetroSim.App.Views;

namespace MetroSim.App;

/// <summary>
/// Composition root: game session, main view model and window, configured from the command line.
/// The desktop app and the headless UI tests start the app the same way through <see cref="Create"/>.
/// </summary>
public sealed class AppHost : IDisposable
{
    private AppHost(GameSession session, MainViewModel viewModel, MainWindow window)
    {
        Session = session;
        ViewModel = viewModel;
        Window = window;
    }

    public GameSession Session { get; }

    public MainViewModel ViewModel { get; }

    public MainWindow Window { get; }

    public static AppHost Create(AppOptions options, IFileDialogs dialogs)
    {
        var session = GameSession.Start(options);
        var viewModel = new MainViewModel(session, dialogs);
        if (options.LoadPath is { } path)
        {
            var result = session.Load(path);
            viewModel.ShowStatus(result.Message, !result.Success);
        }

        session.Warmup(options.WarmupDays);
        viewModel.SelectedOverlay = OverlayInfo.Of(options.Overlay);
        viewModel.Speed = options.Speed;
        viewModel.Refresh();
        var window = new MainWindow(viewModel);
        if (options.Zoom is { } zoom)
        {
            window.Map.InitialZoom = zoom;
        }

        return new AppHost(session, viewModel, window);
    }

    public void Dispose()
    {
        ViewModel.Dispose();
        Session.Dispose();
    }
}
