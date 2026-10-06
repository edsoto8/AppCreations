using Avalonia;
using Avalonia.Headless;
using BoardFlow.Tests.App.Support;

[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]
[assembly: AvaloniaTestIsolation(AvaloniaTestIsolationLevel.PerAssembly)]

namespace BoardFlow.Tests.App.Support;

/// <summary>Runs the real <see cref="BoardFlow.App.App"/> (styles, theme, fonts) on Avalonia's headless platform with Skia rendering.</summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<BoardFlow.App.App>()
            .UseSkia()
            .WithInterFont()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}
