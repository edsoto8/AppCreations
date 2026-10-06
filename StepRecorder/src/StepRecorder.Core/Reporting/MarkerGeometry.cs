using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Reporting;

/// <summary>
/// Where and how big the click marker is on a screenshot, in screenshot pixels. The HTML overlay and the
/// burned-in copies both use this, so they always match.
/// </summary>
public static class MarkerGeometry
{
    public const int DefaultDpi = 96;

    /// <summary>
    /// The click offset from the window's top-left is also the offset into the screenshot, because both
    /// use the window frame's top-left in physical pixels (ADR 0004). The marker grows with the window's
    /// DPI, so it looks the same size on a 100% and a 200% monitor.
    /// </summary>
    /// <returns>Null when markers are off, the click has no window offset, or it falls outside the image.</returns>
    public static ClickMarker? For(Step step, int imageWidth, int imageHeight, ScreenshotSettings settings)
    {
        if (!settings.ClickMarkerEnabled
            || step.ClickXRelativeToWindow is not { } x
            || step.ClickYRelativeToWindow is not { } y
            || x < 0 || y < 0 || x >= imageWidth || y >= imageHeight)
        {
            return null;
        }

        int dpi = step.WindowDpi is > 0 and int value ? value : DefaultDpi;
        int size = settings.Clamped().ClickMarkerSize;
        int diameter = Math.Max(8, (int)Math.Round(size * dpi / (double)DefaultDpi));
        int stroke = Math.Max(2, (int)Math.Round(diameter / 10.0));
        return new ClickMarker(x, y, diameter, stroke);
    }
}
