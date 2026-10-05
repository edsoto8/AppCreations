namespace SkyHop.Core;

/// <summary>A top and bottom obstacle with an opening between them. Instances are pooled and reused.</summary>
public sealed class ObstaclePair
{
    /// <summary>Hitboxes extend this far above the world, so the player can never fly over an obstacle.</summary>
    private const double AboveWorld = 1000;

    /// <summary>Increments every time the pair is (re)spawned, so renderers and tests can tell pairs apart.</summary>
    public int Id { get; private set; }

    /// <summary>Left edge.</summary>
    public double X { get; internal set; }
    public double Width { get; private set; }
    public double GapCenter { get; private set; }
    public double GapSize { get; private set; }

    /// <summary>True once this pair has awarded its point.</summary>
    public bool Scored { get; internal set; }

    public double GapTop => GapCenter - GapSize / 2;
    public double GapBottom => GapCenter + GapSize / 2;
    public double CenterX => X + Width / 2;
    public double Right => X + Width;

    internal void Spawn(int id, double x, double width, double gapCenter, double gapSize)
    {
        Id = id;
        X = x;
        Width = width;
        GapCenter = gapCenter;
        GapSize = gapSize;
        Scored = false;
    }

    public Rect TopHitbox(double inset) =>
        new(X + inset, -AboveWorld, Width - 2 * inset, GapTop + AboveWorld);

    public Rect BottomHitbox(double inset, double groundY) =>
        new(X + inset, GapBottom, Width - 2 * inset, groundY - GapBottom);
}
