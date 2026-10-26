using MetroSim.Core.Mathematics;
using SkiaSharp;

namespace MetroSim.App.Rendering;

public enum SpriteKind : byte
{
    Car = 0,
    Pedestrian = 1,
    FireTruck = 2,
}

/// <summary>
/// A vehicle's motion during the current tick interval, as a short polyline in tile coordinates
/// (lane offsets applied) from its position at the previous tick to its position at the current tick.
/// The renderer walks the polyline by wall-clock fraction, so cars glide between ticks and turn corners.
/// </summary>
public struct VehicleSprite
{
    public const int MaxPoints = 4;

    public int Id;
    public SpriteKind Kind;
    public byte PointCount;
    public Direction StartHeading;
    public Direction EndHeading;
    public float X0, Y0, X1, Y1, X2, Y2, X3, Y3;

    public readonly (float X, float Y) Point(int i) => i switch
    {
        0 => (X0, Y0),
        1 => (X1, Y1),
        2 => (X2, Y2),
        _ => (X3, Y3),
    };

    public void SetPoint(int i, float x, float y)
    {
        switch (i)
        {
            case 0: X0 = x; Y0 = y; break;
            case 1: X1 = x; Y1 = y; break;
            case 2: X2 = x; Y2 = y; break;
            default: X3 = x; Y3 = y; break;
        }
    }

    public readonly (float X, float Y) End => Point(PointCount - 1);

    /// <summary>Position and heading at fraction <paramref name="t"/> (0 = previous tick, 1 = current tick).</summary>
    public readonly (float X, float Y, bool Horizontal) Evaluate(float t)
    {
        if (PointCount <= 1 || t >= 1)
        {
            var (ex, ey) = End;
            return (ex, ey, EndHeading is Direction.East or Direction.West);
        }

        float total = 0;
        for (int i = 1; i < PointCount; i++)
        {
            total += Distance(Point(i - 1), Point(i));
        }

        float target = Math.Max(0, t) * total;
        for (int i = 1; i < PointCount; i++)
        {
            var a = Point(i - 1);
            var b = Point(i);
            float d = Distance(a, b);
            if (target <= d || i == PointCount - 1)
            {
                float f = d <= 0 ? 1 : Math.Clamp(target / d, 0, 1);
                bool horizontal = d > 0.001f ? Math.Abs(b.X - a.X) >= Math.Abs(b.Y - a.Y) : StartHeading is Direction.East or Direction.West;
                return (a.X + (b.X - a.X) * f, a.Y + (b.Y - a.Y) * f, horizontal);
            }

            target -= d;
        }

        var (lx, ly) = End;
        return (lx, ly, EndHeading is Direction.East or Direction.West);
    }

    private static float Distance((float X, float Y) a, (float X, float Y) b) =>
        MathF.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
}

/// <summary>A burning building (drawn with an animated flicker).</summary>
public readonly record struct FireSprite(int Id, int X, int Y, int Size, int Damage);

/// <summary>A completed building that lacks power and/or water (drawn as a small blinking icon).</summary>
public readonly record struct AlertSprite(int X, int Y, int Size, bool NoPower, bool NoWater);

/// <summary>Tile rectangle, inclusive.</summary>
public readonly record struct TileRect(int MinX, int MinY, int MaxX, int MaxY)
{
    public static TileRect Of(int x0, int y0, int x1, int y1) =>
        new(Math.Min(x0, x1), Math.Min(y0, y1), Math.Max(x0, x1), Math.Max(y0, y1));

    public int Width => MaxX - MinX + 1;

    public int Height => MaxY - MinY + 1;
}

/// <summary>Ghost of what the active tool would do; the label is drawn next to the cursor.</summary>
public sealed record ToolPreview(IReadOnlyList<TileRect> Rects, SKColor Colour, bool Valid, string Label, double LabelX, double LabelY);

/// <summary>Selected object outline and, for a vehicle, its remaining route.</summary>
public sealed record SelectionSprite(TileRect? Outline, int[]? RouteTiles, int SelectedVehicleId);

/// <summary>
/// Everything one frame draws. Built on the UI thread (under the state lock) and never mutated
/// afterwards, so the render thread can draw it while the simulation keeps ticking.
/// </summary>
public sealed record FrameSnapshot
{
    public required CameraView Camera { get; init; }

    public required StaticSnapshot Static { get; init; }

    public required VehicleSprite[] Vehicles { get; init; }

    public required int VehicleCount { get; init; }

    /// <summary>Stopwatch timestamp at which the current tick was first seen.</summary>
    public required long TickSeenTimestamp { get; init; }

    /// <summary>Expected seconds between ticks at the current speed (interpolation length).</summary>
    public required double TickIntervalSeconds { get; init; }

    public required bool Paused { get; init; }

    public required FireSprite[] Fires { get; init; }

    public required AlertSprite[] Alerts { get; init; }

    public OverlayLayer? Overlay { get; init; }

    public ToolPreview? Preview { get; init; }

    public SelectionSprite? Selection { get; init; }

    /// <summary>Tile grid lines (zoned building tools at close zoom).</summary>
    public bool ShowGrid { get; init; }

    /// <summary>Interpolation fraction at <paramref name="timestamp"/>, 0..1.</summary>
    public float InterpolationAt(long timestamp)
    {
        if (Paused || TickIntervalSeconds <= 0)
        {
            return 1;
        }

        double elapsed = (timestamp - TickSeenTimestamp) / (double)System.Diagnostics.Stopwatch.Frequency;
        return (float)Math.Clamp(elapsed / TickIntervalSeconds, 0, 1);
    }
}
