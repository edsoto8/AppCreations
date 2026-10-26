using System.Globalization;
using Avalonia;
using MetroSim.App.Rendering;

namespace MetroSim.App;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var options = AppOptions.Parse(args);
        foreach (var warning in options.Warnings)
        {
            Console.Error.WriteLine("metrosim: " + warning);
        }

        if (options.BenchmarkFrames is not null)
        {
            return RenderBenchmark.Run(options, Console.Out);
        }

        BuildAvaloniaApp(options).StartWithClassicDesktopLifetime(args);
        return 0;
    }

    /// <summary>Used by the visual designer.</summary>
    public static AppBuilder BuildAvaloniaApp() => BuildAvaloniaApp(new AppOptions());

    private static AppBuilder BuildAvaloniaApp(AppOptions options) =>
        AppBuilder.Configure(() => new App(options))
            .UsePlatformDetect()
            .WithInterFont();
}
