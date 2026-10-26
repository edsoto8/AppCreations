using System.Diagnostics;
using System.Runtime.InteropServices;
using MetroSim.Core.Mathematics;
using SkiaSharp;

namespace MetroSim.App.Rendering;

/// <summary>
/// Draws a <see cref="FrameSnapshot"/> onto a Skia canvas: cached static chunks, overlay, then the
/// dynamic layer (turbine blades, fires, vehicles, alerts, selection, tool ghost), culled to the
/// viewport. Owns every Skia resource it uses; called from one thread at a time (the compositor's
/// render thread, or the benchmark), guarded by its own lock so disposal cannot race a frame.
/// </summary>
public sealed class MapRenderer : IDisposable
{
    private readonly object _gate = new();
    private readonly ChunkCache _chunks = new();
    private readonly SKPaint _image = new() { IsAntialias = false };
    private readonly SKPaint _fill = new() { IsAntialias = false, Style = SKPaintStyle.Fill };
    private readonly SKPaint _smooth = new() { IsAntialias = true, Style = SKPaintStyle.Fill };
    private readonly SKPaint _stroke = new() { IsAntialias = true, Style = SKPaintStyle.Stroke };
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private SKImage? _overlayImage;
    private OverlayLayer? _overlaySource;
    private bool _disposed;

    public RenderStats Stats { get; } = new();

    /// <summary>See <see cref="ChunkCache.PaintBudgetMilliseconds"/>; tests set infinity for complete frames.</summary>
    public double ChunkPaintBudgetMilliseconds
    {
        get => _chunks.PaintBudgetMilliseconds;
        set => _chunks.PaintBudgetMilliseconds = value;
    }

    public void Render(SKCanvas canvas, FrameSnapshot frame)
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            long started = Stopwatch.GetTimestamp();
            Draw(canvas, frame, started);
            Stats.CachedChunks = _chunks.Count;
            Stats.CachedBytes = _chunks.Bytes;
            Stats.ChunksPaintedLastFrame = _chunks.PaintedThisFrame;
            Stats.RecordFrame(Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            _chunks.Dispose();
            _overlayImage?.Dispose();
            _image.Dispose();
            _fill.Dispose();
            _smooth.Dispose();
            _stroke.Dispose();
        }
    }

    private void Draw(SKCanvas canvas, FrameSnapshot f, long timestamp)
    {
        var cam = f.Camera;
        var s = f.Static;
        canvas.Save();
        canvas.ClipRect(new SKRect(0, 0, (float)cam.ViewWidth, (float)cam.ViewHeight));
        _fill.Color = Palette.Background;
        canvas.DrawRect(0, 0, (float)cam.ViewWidth, (float)cam.ViewHeight, _fill);

        // Device pixels per tile decide the chunk resolution (HiDPI screens get sharper chunks).
        double deviceScale = Math.Max(1, canvas.TotalMatrix.ScaleX);
        int level = ChunkCache.LevelFor(cam.Zoom * deviceScale);
        DrawChunks(canvas, s, cam, level);

        if (f.Overlay is { } overlay)
        {
            DrawOverlay(canvas, cam, overlay, s);
        }

        var (minX, minY, maxX, maxY) = cam.VisibleTiles(s.Width, s.Height);
        if (f.ShowGrid && cam.Zoom >= 10)
        {
            DrawGrid(canvas, cam, minX, minY, maxX, maxY);
        }

        double seconds = _clock.Elapsed.TotalSeconds;
        DrawTurbines(canvas, s, cam, seconds, f.Paused, minX, minY, maxX, maxY);
        DrawFires(canvas, f, cam, seconds);
        DrawVehicles(canvas, f, cam, f.InterpolationAt(timestamp), seconds, minX, minY, maxX, maxY);
        DrawAlerts(canvas, f, cam, f.Paused ? 0 : seconds);
        DrawSelection(canvas, f, cam, s.Width);
        DrawPreview(canvas, f, cam);
        canvas.Restore();
    }

    private void DrawChunks(SKCanvas canvas, StaticSnapshot s, CameraView cam, int level)
    {
        _chunks.BeginFrame(s);
        int size = StaticSnapshot.ChunkSize;
        int cx0 = Math.Max(0, (int)Math.Floor(cam.WorldX(0) / size));
        int cy0 = Math.Max(0, (int)Math.Floor(cam.WorldY(0) / size));
        int cx1 = Math.Min(s.ChunksX - 1, (int)Math.Floor(cam.WorldX(cam.ViewWidth) / size));
        int cy1 = Math.Min(s.ChunksY - 1, (int)Math.Floor(cam.WorldY(cam.ViewHeight) / size));
        // Smooth sampling when shrinking a chunk, crisp pixels when it is shown near 1:1 or enlarged.
        var sampling = new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None);
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                var image = _chunks.Get(s, cx, cy, level);
                int tilesX = Math.Min(size, s.Width - cx * size);
                int tilesY = Math.Min(size, s.Height - cy * size);
                var dest = new SKRect(
                    (float)cam.ScreenX(cx * size),
                    (float)cam.ScreenY(cy * size),
                    (float)cam.ScreenX(cx * size + tilesX),
                    (float)cam.ScreenY(cy * size + tilesY));
                canvas.DrawImage(image, new SKRect(0, 0, image.Width, image.Height), dest, sampling, _image);
            }
        }

        _chunks.EndFrame();
    }

    private void DrawOverlay(SKCanvas canvas, CameraView cam, OverlayLayer overlay, StaticSnapshot s)
    {
        var dest = new SKRect((float)cam.ScreenX(0), (float)cam.ScreenY(0), (float)cam.ScreenX(overlay.Width), (float)cam.ScreenY(overlay.Height));
        _fill.Color = new SKColor(0x0C, 0x10, 0x18, (byte)(overlay.Dim * 255));
        canvas.DrawRect(dest, _fill);

        if (overlay.Kind == OverlayKind.Traffic && cam.Zoom >= 5 && overlay.Width == s.Width)
        {
            // Close enough to see roads: colour each lane strip instead of whole tiles.
            DrawRoadOverlay(canvas, cam, overlay, s);
            return;
        }

        if (!ReferenceEquals(overlay, _overlaySource))
        {
            _overlayImage?.Dispose();
            var info = new SKImageInfo(overlay.Width, overlay.Height, SKColorType.Bgra8888, SKAlphaType.Premul);
            _overlayImage = SKImage.FromPixelCopy(info, MemoryMarshal.AsBytes(overlay.Pixels.AsSpan()), overlay.Width * 4);
            _overlaySource = overlay;
        }

        if (_overlayImage is null)
        {
            return;
        }

        var sampling = overlay.Smooth && cam.Zoom > 1
            ? new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None)
            : new SKSamplingOptions(SKFilterMode.Nearest, SKMipmapMode.None);
        canvas.DrawImage(_overlayImage, new SKRect(0, 0, overlay.Width, overlay.Height), dest, sampling, _image);
    }

    /// <summary>Road-shaped overlay: a coloured band along each visible road tile and its connections.</summary>
    private void DrawRoadOverlay(SKCanvas canvas, CameraView cam, OverlayLayer overlay, StaticSnapshot s)
    {
        var (minX, minY, maxX, maxY) = cam.VisibleTiles(s.Width, s.Height);
        float zoom = (float)cam.Zoom;
        for (int y = minY; y <= maxY; y++)
        {
            for (int x = minX; x <= maxX; x++)
            {
                int t = y * s.Width + x;
                uint p = overlay.Pixels[t];
                if (p >> 24 == 0 || s.Roads[t] == Core.World.RoadType.None)
                {
                    continue;
                }

                _fill.Color = Unpack(p);
                float half = zoom * (s.Roads[t] == Core.World.RoadType.Avenue ? 0.3f : 0.2f);
                float cx = (float)cam.ScreenX(x + 0.5);
                float cy = (float)cam.ScreenY(y + 0.5);
                float h = zoom / 2;
                canvas.DrawRect(cx - half, cy - half, half * 2, half * 2, _fill);
                if (s.IsRoad(x, y - 1))
                {
                    canvas.DrawRect(cx - half, cy - h, half * 2, h, _fill);
                }

                if (s.IsRoad(x, y + 1))
                {
                    canvas.DrawRect(cx - half, cy, half * 2, h, _fill);
                }

                if (s.IsRoad(x - 1, y))
                {
                    canvas.DrawRect(cx - h, cy - half, h, half * 2, _fill);
                }

                if (s.IsRoad(x + 1, y))
                {
                    canvas.DrawRect(cx, cy - half, h, half * 2, _fill);
                }
            }
        }
    }

    /// <summary>Premultiplied 0xAARRGGBB back to a colour.</summary>
    private static SKColor Unpack(uint p)
    {
        uint a = p >> 24;
        return new SKColor(
            (byte)Math.Min(255, ((p >> 16) & 0xFF) * 255 / a),
            (byte)Math.Min(255, ((p >> 8) & 0xFF) * 255 / a),
            (byte)Math.Min(255, (p & 0xFF) * 255 / a),
            (byte)a);
    }

    private void DrawGrid(SKCanvas canvas, CameraView cam, int minX, int minY, int maxX, int maxY)
    {
        _stroke.Color = new SKColor(0xFF, 0xFF, 0xFF, 28);
        _stroke.StrokeWidth = 1;
        float top = (float)cam.ScreenY(minY);
        float bottom = (float)cam.ScreenY(maxY + 1);
        float left = (float)cam.ScreenX(minX);
        float right = (float)cam.ScreenX(maxX + 1);
        for (int x = minX; x <= maxX + 1; x++)
        {
            float sx = (float)cam.ScreenX(x);
            canvas.DrawLine(sx, top, sx, bottom, _stroke);
        }

        for (int y = minY; y <= maxY + 1; y++)
        {
            float sy = (float)cam.ScreenY(y);
            canvas.DrawLine(left, sy, right, sy, _stroke);
        }
    }

    private void DrawTurbines(SKCanvas canvas, StaticSnapshot s, CameraView cam, double seconds, bool paused,
        int minX, int minY, int maxX, int maxY)
    {
        if (cam.Zoom < 6 || s.WindTurbines.Length == 0)
        {
            return;
        }

        _stroke.Color = new SKColor(0xF4, 0xF6, 0xF8);
        _stroke.StrokeWidth = (float)Math.Max(1, cam.Zoom * 0.07);
        _stroke.StrokeCap = SKStrokeCap.Round;
        foreach (int tile in s.WindTurbines)
        {
            int x = tile % s.Width;
            int y = tile / s.Width;
            if (x < minX || x > maxX || y < minY || y > maxY)
            {
                continue;
            }

            float cx = (float)cam.ScreenX(x + 0.5);
            float cy = (float)cam.ScreenY(y + 0.5);
            float length = (float)(cam.Zoom * 0.46);
            double angle = (paused ? 0 : seconds * 2.4) + (Palette.Hash(x, y) & 0xFF) / 40.0;
            for (int k = 0; k < 3; k++)
            {
                double a = angle + k * Math.PI * 2 / 3;
                canvas.DrawLine(cx, cy, cx + (float)Math.Cos(a) * length, cy + (float)Math.Sin(a) * length, _stroke);
            }

            _smooth.Color = new SKColor(0x90, 0x98, 0xA0);
            canvas.DrawCircle(cx, cy, (float)Math.Max(1, cam.Zoom * 0.07), _smooth);
        }

        _stroke.StrokeCap = SKStrokeCap.Butt;
    }

    private void DrawFires(SKCanvas canvas, FrameSnapshot f, CameraView cam, double seconds)
    {
        foreach (var fire in f.Fires)
        {
            float x = (float)cam.ScreenX(fire.X);
            float y = (float)cam.ScreenY(fire.Y);
            float size = (float)(fire.Size * cam.Zoom);
            if (x > cam.ViewWidth || y > cam.ViewHeight || x + size < 0 || y + size < 0)
            {
                continue;
            }

            // Charring grows with damage, flames flicker.
            _fill.Color = new SKColor(0x18, 0x10, 0x0C, (byte)Math.Clamp(fire.Damage * 1.6, 30, 170));
            canvas.DrawRect(x, y, size, size, _fill);
            double flicker = 0.65 + 0.35 * Math.Sin(seconds * 13 + fire.Id * 1.7) * Math.Sin(seconds * 7.3 + fire.Id);
            float cx = x + size / 2;
            float cy = y + size / 2;
            float radius = size * (0.55f + (float)flicker * 0.25f);
            using (var shader = SKShader.CreateRadialGradient(new SKPoint(cx, cy), Math.Max(1, radius),
                [new SKColor(0xFF, 0xE0, 0x60, (byte)(230 * flicker)), new SKColor(0xFF, 0x50, 0x10, (byte)(150 * flicker)), SKColors.Transparent],
                [0, 0.45f, 1], SKShaderTileMode.Clamp))
            {
                _smooth.Shader = shader;
                canvas.DrawCircle(cx, cy, radius, _smooth);
                _smooth.Shader = null;
            }

            if (cam.Zoom >= 8)
            {
                // A few tongues of flame dancing around the centre.
                for (int k = 0; k < 3; k++)
                {
                    double a = seconds * (3 + k) + k * 2.1 + fire.Id;
                    float fx = cx + (float)Math.Cos(a) * size * 0.18f;
                    float fy = cy + (float)Math.Sin(a * 1.3) * size * 0.14f;
                    _smooth.Color = new SKColor(0xFF, (byte)(0x90 + k * 0x30), 0x20, 220);
                    canvas.DrawCircle(fx, fy, size * (0.1f + 0.04f * (float)flicker), _smooth);
                }
            }
        }
    }

    private void DrawVehicles(SKCanvas canvas, FrameSnapshot f, CameraView cam, float t, double seconds,
        int minX, int minY, int maxX, int maxY)
    {
        float zoom = (float)cam.Zoom;
        int visible = 0;
        bool dots = zoom < 5;
        for (int i = 0; i < f.VehicleCount; i++)
        {
            ref readonly var v = ref f.Vehicles[i];
            var (x, y, horizontal) = v.Evaluate(t);
            if (x < minX || x > maxX + 1 || y < minY || y > maxY + 1)
            {
                continue;
            }

            visible++;
            float sx = (float)cam.ScreenX(x);
            float sy = (float)cam.ScreenY(y);
            if (v.Kind == SpriteKind.Pedestrian)
            {
                if (zoom < 8)
                {
                    continue;
                }

                _smooth.Color = Palette.Pedestrian;
                canvas.DrawCircle(sx, sy, Math.Max(1f, zoom * 0.055f), _smooth);
                continue;
            }

            bool truck = v.Kind == SpriteKind.FireTruck;
            var colour = truck ? Palette.FireTruck : Palette.CarColours[(uint)v.Id % Palette.CarColours.Length];
            if (dots)
            {
                _fill.Color = colour;
                float d = truck ? 2.5f : 1.5f;
                canvas.DrawRect(sx - d / 2, sy - d / 2, d, d, _fill);
                continue;
            }

            float length = zoom * (truck ? 0.46f : 0.36f);
            float width = zoom * (truck ? 0.22f : 0.19f);
            float w = horizontal ? length : width;
            float h = horizontal ? width : length;
            var body = new SKRect(sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2);
            _fill.Color = new SKColor(0, 0, 0, 70);
            canvas.DrawRect(body.Left + 1, body.Top + 1, body.Width, body.Height, _fill);
            _fill.Color = colour;
            canvas.DrawRect(body, _fill);
            if (zoom >= 14)
            {
                // Windscreen at the front, in the direction of travel.
                var heading = v.EndHeading;
                float g = zoom * 0.07f;
                _fill.Color = new SKColor(0x20, 0x2C, 0x38, 200);
                var glass = heading switch
                {
                    Direction.East => new SKRect(body.Right - g * 1.6f, body.Top + 1, body.Right - g * 0.6f, body.Bottom - 1),
                    Direction.West => new SKRect(body.Left + g * 0.6f, body.Top + 1, body.Left + g * 1.6f, body.Bottom - 1),
                    Direction.South => new SKRect(body.Left + 1, body.Bottom - g * 1.6f, body.Right - 1, body.Bottom - g * 0.6f),
                    _ => new SKRect(body.Left + 1, body.Top + g * 0.6f, body.Right - 1, body.Top + g * 1.6f),
                };
                canvas.DrawRect(glass, _fill);
            }

            if (truck)
            {
                bool flash = ((int)(seconds * 6) & 1) == 0;
                _smooth.Color = flash ? new SKColor(0x40, 0x80, 0xFF) : new SKColor(0xFF, 0xFF, 0xFF);
                canvas.DrawCircle(sx, sy, Math.Max(1, zoom * 0.05f), _smooth);
            }
        }

        Stats.VisibleVehicles = visible;
    }

    private void DrawAlerts(SKCanvas canvas, FrameSnapshot f, CameraView cam, double seconds)
    {
        if (cam.Zoom < 10 || f.Alerts.Length == 0 || seconds % 1.2 > 0.8)
        {
            return;
        }

        float r = (float)Math.Clamp(cam.Zoom * 0.17, 4, 9);
        foreach (var a in f.Alerts)
        {
            float x = (float)cam.ScreenX(a.X + a.Size) - r * 1.2f;
            float y = (float)cam.ScreenY(a.Y) + r * 1.2f;
            if (x < -r || y < -r || x > cam.ViewWidth + r || y > cam.ViewHeight + r)
            {
                continue;
            }

            if (a.NoPower)
            {
                _smooth.Color = new SKColor(0x20, 0x20, 0x20, 220);
                canvas.DrawCircle(x, y, r, _smooth);
                using var bolt = new SKPath();
                bolt.MoveTo(x + r * 0.15f, y - r * 0.75f);
                bolt.LineTo(x - r * 0.45f, y + r * 0.1f);
                bolt.LineTo(x - r * 0.02f, y + r * 0.1f);
                bolt.LineTo(x - r * 0.2f, y + r * 0.78f);
                bolt.LineTo(x + r * 0.45f, y - r * 0.15f);
                bolt.LineTo(x + r * 0.02f, y - r * 0.15f);
                bolt.Close();
                _smooth.Color = new SKColor(0xFF, 0xD8, 0x20);
                canvas.DrawPath(bolt, _smooth);
                x -= r * 2.2f;
            }

            if (a.NoWater)
            {
                _smooth.Color = new SKColor(0x20, 0x20, 0x20, 220);
                canvas.DrawCircle(x, y, r, _smooth);
                _smooth.Color = new SKColor(0x50, 0xB0, 0xFF);
                using var drop = new SKPath();
                drop.MoveTo(x, y - r * 0.7f);
                drop.QuadTo(x + r * 0.55f, y + r * 0.05f, x, y + r * 0.6f);
                drop.QuadTo(x - r * 0.55f, y + r * 0.05f, x, y - r * 0.7f);
                drop.Close();
                canvas.DrawPath(drop, _smooth);
            }
        }
    }

    private void DrawSelection(SKCanvas canvas, FrameSnapshot f, CameraView cam, int mapWidth)
    {
        if (f.Selection is not { } sel)
        {
            return;
        }

        if (sel.RouteTiles is { Length: > 1 } route)
        {
            using var path = new SKPath();
            for (int i = 0; i < route.Length; i++)
            {
                float x = (float)cam.ScreenX(route[i] % mapWidth + 0.5);
                float y = (float)cam.ScreenY(route[i] / mapWidth + 0.5);
                if (i == 0)
                {
                    path.MoveTo(x, y);
                }
                else
                {
                    path.LineTo(x, y);
                }
            }

            _stroke.Color = new SKColor(0x40, 0xE0, 0xFF, 190);
            _stroke.StrokeWidth = (float)Math.Max(2, cam.Zoom * 0.16);
            _stroke.StrokeJoin = SKStrokeJoin.Round;
            _stroke.StrokeCap = SKStrokeCap.Round;
            canvas.DrawPath(path, _stroke);
            _stroke.StrokeCap = SKStrokeCap.Butt;
            int last = route[^1];
            _smooth.Color = new SKColor(0x40, 0xE0, 0xFF);
            canvas.DrawCircle((float)cam.ScreenX(last % mapWidth + 0.5), (float)cam.ScreenY(last / mapWidth + 0.5), (float)Math.Max(4, cam.Zoom * 0.3), _smooth);
        }

        if (sel.SelectedVehicleId > 0)
        {
            for (int i = 0; i < f.VehicleCount; i++)
            {
                if (f.Vehicles[i].Id != sel.SelectedVehicleId)
                {
                    continue;
                }

                var (x, y, _) = f.Vehicles[i].Evaluate(f.InterpolationAt(Stopwatch.GetTimestamp()));
                _stroke.Color = SKColors.White;
                _stroke.StrokeWidth = 2;
                canvas.DrawCircle((float)cam.ScreenX(x), (float)cam.ScreenY(y), (float)Math.Max(6, cam.Zoom * 0.35), _stroke);
                break;
            }
        }

        if (sel.Outline is { } r)
        {
            var rect = new SKRect((float)cam.ScreenX(r.MinX), (float)cam.ScreenY(r.MinY), (float)cam.ScreenX(r.MaxX + 1), (float)cam.ScreenY(r.MaxY + 1));
            _fill.Color = new SKColor(0xFF, 0xE0, 0x60, 50);
            canvas.DrawRect(rect, _fill);
            _stroke.Color = new SKColor(0xFF, 0xE0, 0x60);
            _stroke.StrokeWidth = 2;
            canvas.DrawRect(rect, _stroke);
        }
    }

    private void DrawPreview(SKCanvas canvas, FrameSnapshot f, CameraView cam)
    {
        if (f.Preview is not { } p)
        {
            return;
        }

        foreach (var r in p.Rects)
        {
            var rect = new SKRect((float)cam.ScreenX(r.MinX), (float)cam.ScreenY(r.MinY), (float)cam.ScreenX(r.MaxX + 1), (float)cam.ScreenY(r.MaxY + 1));
            _fill.Color = p.Colour.WithAlpha(90);
            canvas.DrawRect(rect, _fill);
            _stroke.Color = p.Colour.WithAlpha(230);
            _stroke.StrokeWidth = 1.5f;
            canvas.DrawRect(rect, _stroke);
        }
    }
}
