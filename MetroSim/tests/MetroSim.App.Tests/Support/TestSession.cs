using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using MetroSim.App.Controls;
using MetroSim.App.Services;
using MetroSim.App.ViewModels;
using MetroSim.App.Views;
using MetroSim.Core.Engine;

namespace MetroSim.App.Tests.Support;

/// <summary>File dialogs that answer with preset paths.</summary>
public sealed class FakeFileDialogs : IFileDialogs
{
    public string? NextSavePath { get; set; }

    public string? NextOpenPath { get; set; }

    public Task<string?> PickSavePath(string suggestedName, string? startFolder) => Task.FromResult(NextSavePath);

    public Task<string?> PickOpenPath(string? startFolder) => Task.FromResult(NextOpenPath);
}

/// <summary>
/// Starts the app exactly like <c>App</c> does (through <see cref="AppHost"/>) with a temporary saves
/// folder and fake file dialogs, shows the window on the headless platform and drives it with
/// simulated mouse and keyboard input.
/// </summary>
public sealed class TestSession : IDisposable
{
    public TestSession(AppOptions? options = null)
    {
        Folder = Path.Combine(Path.GetTempPath(), "metrosim-ui-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Folder);
        Host = AppHost.Create((options ?? new AppOptions { Seed = 7 }) with { SavesDirectory = Path.Combine(Folder, "saves") }, Dialogs);
        // Screenshots must show complete frames: paint every visible chunk immediately.
        Map.Renderer.ChunkPaintBudgetMilliseconds = double.PositiveInfinity;
    }

    public string Folder { get; }

    public FakeFileDialogs Dialogs { get; } = new();

    public AppHost Host { get; }

    public MainWindow Window => Host.Window;

    public MainViewModel Vm => Host.ViewModel;

    public MapView Map => Host.Window.Map;

    public SimulationRunner Runner => Host.Session.Runner;

    /// <summary>Reads simulation state under the state lock, as the app does.</summary>
    public T Read<T>(Func<Simulation, T> read)
    {
        lock (Runner.StateLock)
        {
            return read(Runner.Simulation);
        }
    }

    public MainWindow Show(double width = 1600, double height = 900)
    {
        Window.Width = width;
        Window.Height = height;
        Window.Show();
        Pump();
        Frame();
        return Window;
    }

    /// <summary>Runs queued dispatcher work and one render timer tick (the map's animation frame).</summary>
    public static void Pump()
    {
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        Dispatcher.UIThread.RunJobs();
    }

    /// <summary>Builds a fresh map frame and dashboard refresh, and lets the compositor render it.</summary>
    public void Frame()
    {
        Map.Renderer.ChunkPaintBudgetMilliseconds = double.PositiveInfinity;
        Vm.Refresh();
        Map.RefreshStaticNow();
        Map.RefreshFrame();
        Pump();
    }

    /// <summary>Advances the simulation synchronously (the runner stays paused).</summary>
    public void Step(int ticks)
    {
        Runner.StepNow(ticks);
        Frame();
    }

    public WriteableBitmap Capture()
    {
        Frame();
        return Window.CaptureRenderedFrame() ?? throw new InvalidOperationException("No frame was rendered.");
    }

    /// <summary>
    /// Saves a PNG to the test output folder, and to <c>METROSIM_SCREENSHOTS</c> when that variable
    /// names a folder (used to refresh <c>docs/screenshots</c>).
    /// </summary>
    public string Screenshot(string name)
    {
        using var frame = Capture();
        string local = Path.Combine(AppContext.BaseDirectory, "screenshots");
        Directory.CreateDirectory(local);
        string path = Path.Combine(local, name + ".png");
        frame.Save(path, PngBitmapEncoderOptions.Default);
        var folder = Environment.GetEnvironmentVariable("METROSIM_SCREENSHOTS");
        if (!string.IsNullOrEmpty(folder))
        {
            Directory.CreateDirectory(folder);
            frame.Save(Path.Combine(folder, name + ".png"), PngBitmapEncoderOptions.Default);
        }

        return path;
    }

    /// <summary>Window coordinates of a tile's centre on the map.</summary>
    public Point TilePoint(int x, int y)
    {
        var local = Map.TileCenter(x, y);
        return Map.TranslatePoint(local, Window) ?? throw new InvalidOperationException("Map is not in the window.");
    }

    public void Key(Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        Window.KeyPress(key, modifiers, PhysicalKey.None, null);
        Window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        Pump();
    }

    /// <summary>Left-drags across the map from one tile to another in small pointer steps.</summary>
    public void DragTiles(int x0, int y0, int x1, int y1, int steps = 8, Action? beforeRelease = null)
    {
        var from = TilePoint(x0, y0);
        var to = TilePoint(x1, y1);
        Window.MouseMove(from, RawInputModifiers.None);
        Window.MouseDown(from, MouseButton.Left, RawInputModifiers.None);
        Pump();
        for (int i = 1; i <= steps; i++)
        {
            Window.MouseMove(from + (to - from) * i / steps, RawInputModifiers.LeftMouseButton);
            Pump();
        }

        Map.RefreshFrame();
        beforeRelease?.Invoke();
        Window.MouseUp(to, MouseButton.Left, RawInputModifiers.None);
        Pump();
    }

    public void ClickTile(int x, int y)
    {
        var p = TilePoint(x, y);
        Window.MouseMove(p, RawInputModifiers.None);
        Pump();
        Map.RefreshFrame();
        Window.MouseDown(p, MouseButton.Left, RawInputModifiers.None);
        Window.MouseUp(p, MouseButton.Left, RawInputModifiers.None);
        Pump();
    }

    public void Dispose()
    {
        if (Window.IsVisible)
        {
            Window.Close();
            Dispatcher.UIThread.RunJobs();
        }

        Host.Dispose();
        try
        {
            Directory.Delete(Folder, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
