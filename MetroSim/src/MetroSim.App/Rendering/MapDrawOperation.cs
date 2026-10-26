using Avalonia;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Rendering.SceneGraph;
using Avalonia.Skia;

namespace MetroSim.App.Rendering;

/// <summary>
/// Hands one immutable <see cref="FrameSnapshot"/> to the <see cref="MapRenderer"/> on the compositor's
/// render thread, drawing straight onto its Skia canvas.
/// </summary>
public sealed class MapDrawOperation(Rect bounds, FrameSnapshot frame, MapRenderer renderer) : ICustomDrawOperation
{
    public Rect Bounds { get; } = bounds;

    public bool HitTest(Point p) => Bounds.Contains(p);

    // Every frame is new content; never let the compositor skip it as "equal".
    public bool Equals(ICustomDrawOperation? other) => false;

    public void Render(ImmediateDrawingContext context)
    {
        if (context.TryGetFeature<ISkiaSharpApiLeaseFeature>() is not { } feature)
        {
            return;
        }

        using var lease = feature.Lease();
        renderer.Render(lease.SkCanvas, frame);
    }

    public void Dispose()
    {
    }
}
