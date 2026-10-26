namespace MetroSim.App.Rendering;

/// <summary>Immutable copy of the camera for one frame. Coordinates are in tiles and device-independent pixels.</summary>
public readonly record struct CameraView(double CenterX, double CenterY, double Zoom, double ViewWidth, double ViewHeight)
{
    public double ScreenX(double worldX) => (worldX - CenterX) * Zoom + ViewWidth / 2;

    public double ScreenY(double worldY) => (worldY - CenterY) * Zoom + ViewHeight / 2;

    public double WorldX(double screenX) => (screenX - ViewWidth / 2) / Zoom + CenterX;

    public double WorldY(double screenY) => (screenY - ViewHeight / 2) / Zoom + CenterY;

    /// <summary>Tile range touched by the viewport, clamped to the map, inclusive.</summary>
    public (int MinX, int MinY, int MaxX, int MaxY) VisibleTiles(int mapWidth, int mapHeight, int margin = 1) => (
        Math.Max(0, (int)Math.Floor(WorldX(0)) - margin),
        Math.Max(0, (int)Math.Floor(WorldY(0)) - margin),
        Math.Min(mapWidth - 1, (int)Math.Floor(WorldX(ViewWidth)) + margin),
        Math.Min(mapHeight - 1, (int)Math.Floor(WorldY(ViewHeight)) + margin));
}

/// <summary>
/// Pan and zoom state of the map view (UI thread only). <see cref="Zoom"/> is device-independent pixels
/// per tile; the centre is in tile coordinates (tile (x, y) spans [x, x+1) x [y, y+1)).
/// </summary>
public sealed class Camera
{
    public const double MinZoom = 1.5;
    public const double MaxZoom = 64;

    public double CenterX { get; set; }

    public double CenterY { get; set; }

    public double Zoom { get; set; } = 12;

    public double ViewWidth { get; set; } = 800;

    public double ViewHeight { get; set; } = 600;

    public CameraView View => new(CenterX, CenterY, Zoom, ViewWidth, ViewHeight);

    public (double X, double Y) ScreenToWorld(double sx, double sy) => (View.WorldX(sx), View.WorldY(sy));

    public (double X, double Y) WorldToScreen(double wx, double wy) => (View.ScreenX(wx), View.ScreenY(wy));

    public void CenterOn(double worldX, double worldY)
    {
        CenterX = worldX;
        CenterY = worldY;
    }

    /// <summary>Moves the view by a screen-space delta (dragging the map moves it with the pointer).</summary>
    public void PanByScreen(double dx, double dy)
    {
        CenterX -= dx / Zoom;
        CenterY -= dy / Zoom;
    }

    /// <summary>Zooms by <paramref name="factor"/> keeping the world point under (sx, sy) fixed.</summary>
    public void ZoomAt(double sx, double sy, double factor)
    {
        var (wx, wy) = ScreenToWorld(sx, sy);
        Zoom = Math.Clamp(Zoom * factor, MinZoom, MaxZoom);
        CenterX = wx - (sx - ViewWidth / 2) / Zoom;
        CenterY = wy - (sy - ViewHeight / 2) / Zoom;
    }

    /// <summary>Keeps the centre over the map so the player cannot lose it.</summary>
    public void Clamp(int mapWidth, int mapHeight)
    {
        CenterX = Math.Clamp(CenterX, 0, mapWidth);
        CenterY = Math.Clamp(CenterY, 0, mapHeight);
    }

    /// <summary>Largest zoom (within limits) that shows the whole map.</summary>
    public void Fit(int mapWidth, int mapHeight)
    {
        CenterX = mapWidth / 2.0;
        CenterY = mapHeight / 2.0;
        Zoom = Math.Clamp(Math.Min(ViewWidth / mapWidth, ViewHeight / mapHeight) * 0.95, MinZoom, MaxZoom);
    }
}
