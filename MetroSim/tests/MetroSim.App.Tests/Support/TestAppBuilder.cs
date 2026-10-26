using Avalonia;
using Avalonia.Headless;
using MetroSim.App.Tests.Support;

[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]
[assembly: AvaloniaTestIsolation(AvaloniaTestIsolationLevel.PerAssembly)]

namespace MetroSim.App.Tests.Support;

/// <summary>Runs the real <see cref="App"/> (theme, styles, fonts) on Avalonia's headless platform with Skia rendering.</summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseSkia()
            .WithInterFont()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}
