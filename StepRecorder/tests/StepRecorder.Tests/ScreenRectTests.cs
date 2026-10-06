using StepRecorder.Core.Sessions;

namespace StepRecorder.Tests;

public sealed class ScreenRectTests
{
    [Fact]
    public void Intersect_ReturnsOverlap()
    {
        var window = new ScreenRect(-8, -8, 1936, 1056);   // window rect with invisible borders
        var frame = new ScreenRect(0, 0, 1920, 1040);      // visible frame

        Assert.Equal(frame, frame.Intersect(window));
        Assert.Equal(frame, window.Intersect(frame));
    }

    [Fact]
    public void Intersect_WithoutOverlap_IsEmpty()
    {
        var left = new ScreenRect(-1920, 0, 1920, 1080);
        var right = new ScreenRect(0, 0, 1920, 1080);

        Assert.True(left.Intersect(right).IsEmpty);
    }

    [Fact]
    public void Intersect_PartiallyOffScreen_ClipsToMonitor()
    {
        var monitor = new ScreenRect(0, 0, 1920, 1080);
        var window = new ScreenRect(1700, 900, 800, 600);

        Assert.Equal(new ScreenRect(1700, 900, 220, 180), window.Intersect(monitor));
    }

    [Fact]
    public void RelativeTo_MovesOriginAndKeepsSize()
    {
        var windowRect = new ScreenRect(-1508, 42, 416, 616);
        var frame = new ScreenRect(-1500, 50, 400, 600);

        Assert.Equal(new ScreenRect(8, 8, 400, 600), frame.RelativeTo(windowRect));
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(10, 0)]
    [InlineData(-5, 10)]
    public void IsEmpty_ForZeroOrNegativeSize(int width, int height)
    {
        Assert.True(new ScreenRect(0, 0, width, height).IsEmpty);
    }
}
