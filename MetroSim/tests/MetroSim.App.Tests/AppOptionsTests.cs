using MetroSim.App.Rendering;
using MetroSim.Core.Engine;

namespace MetroSim.App.Tests;

public sealed class AppOptionsTests
{
    [Fact]
    public void ParsesEveryOption()
    {
        var o = AppOptions.Parse(["--seed", "99", "--size", "192", "--auto-mayor", "--days", "3.25", "--speed", "max",
            "--overlay", "landvalue", "--exit-after", "4", "--zoom", "20", "--saves-dir", "/tmp/x", "--load", "a.city"]);
        Assert.Equal(99UL, o.Seed);
        Assert.Equal(192, o.MapSize);
        Assert.True(o.DemoCity);
        Assert.True(o.AutoMayor);
        Assert.Equal(3.25, o.WarmupDays);
        Assert.Equal(SimulationSpeed.Unlimited, o.Speed);
        Assert.Equal(OverlayKind.LandValue, o.Overlay);
        Assert.Equal(4, o.ExitAfterSeconds);
        Assert.Equal(20, o.Zoom);
        Assert.Equal("/tmp/x", o.SavesDirectory);
        Assert.Equal("a.city", o.LoadPath);
        Assert.Empty(o.Warnings);
    }

    [Fact]
    public void BenchmarkFrameCountIsOptional_AndBadInputOnlyWarns()
    {
        Assert.Equal(300, AppOptions.Parse(["--benchmark-render"]).BenchmarkFrames);
        var o = AppOptions.Parse(["--benchmark-render", "50", "--resolution", "800x600", "--speed", "warp", "--bogus", "--seed"]);
        Assert.Equal(50, o.BenchmarkFrames);
        Assert.Equal((800, 600), (o.BenchmarkWidth, o.BenchmarkHeight));
        Assert.Equal(SimulationSpeed.Paused, o.Speed);
        Assert.Equal(3, o.Warnings.Count);
        Assert.Null(o.Seed);
    }
}
