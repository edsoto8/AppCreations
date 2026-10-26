using System.Runtime.InteropServices;
using MetroSim.Core.Buildings;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Rendering;

/// <summary>
/// Paints one chunk of the static map layer (terrain, trees, zones, roads, power lines, buildings) into
/// an off-screen canvas at a fixed resolution of <c>ppt</c> pixels per tile. Level of detail rises with
/// the resolution: lane markings, roof details and tree crowns only appear when they are visible.
/// Not thread-safe (reuses paints); each renderer owns one.
/// </summary>
public sealed class ChunkPainter : IDisposable
{
    private readonly SKPaint _fill = new() { IsAntialias = false, Style = SKPaintStyle.Fill };
    private readonly SKPaint _smooth = new() { IsAntialias = true, Style = SKPaintStyle.Fill };
    private readonly SKPaint _stroke = new() { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeCap = SKStrokeCap.Butt };
    private readonly HashSet<int> _drawn = [];

    public void Dispose()
    {
        _fill.Dispose();
        _smooth.Dispose();
        _stroke.Dispose();
    }

    /// <summary>
    /// Paints chunk (cx, cy) into <paramref name="bitmap"/> with its top-left tile at pixel (0, 0).
    /// Terrain is written straight into the pixels (smoothly blended between tile centres); zones,
    /// trees, roads, lines and buildings are drawn on top with Skia.
    /// </summary>
    public void Paint(SKBitmap bitmap, StaticSnapshot s, int cx, int cy, int ppt)
    {
        int x0 = cx * StaticSnapshot.ChunkSize;
        int y0 = cy * StaticSnapshot.ChunkSize;
        int x1 = Math.Min(s.Width, x0 + StaticSnapshot.ChunkSize);
        int y1 = Math.Min(s.Height, y0 + StaticSnapshot.ChunkSize);
        TerrainPixels(bitmap, s, x0, y0, x1, y1, ppt);

        using var canvas = new SKCanvas(bitmap);
        for (int y = y0; y < y1; y++)
        {
            for (int x = x0; x < x1; x++)
            {
                int t = y * s.Width + x;
                float px = (x - x0) * ppt;
                float py = (y - y0) * ppt;
                if (s.Roads[t] == RoadType.None && s.BuildingAt[t] == 0)
                {
                    if (s.Zones[t] != ZoneType.None)
                    {
                        ZoneTint(canvas, s, x, y, px, py, ppt);
                    }

                    if (s.Trees[t] > 0 && ppt >= 6)
                    {
                        Trees(canvas, s.Trees[t], x, y, px, py, ppt);
                    }
                }
            }
        }

        for (int y = y0; y < y1; y++)
        {
            for (int x = x0; x < x1; x++)
            {
                int t = y * s.Width + x;
                if (s.Roads[t] != RoadType.None)
                {
                    Road(canvas, s, x, y, (x - x0) * ppt, (y - y0) * ppt, ppt);
                }
                else if (s.PowerLines[t])
                {
                    PowerLine(canvas, s, x, y, (x - x0) * ppt, (y - y0) * ppt, ppt);
                }
            }
        }

        _drawn.Clear();
        for (int y = y0; y < y1; y++)
        {
            for (int x = x0; x < x1; x++)
            {
                int id = s.BuildingAt[y * s.Width + x];
                if (id > 0 && id < s.Buildings.Length && _drawn.Add(id))
                {
                    var b = s.Buildings[id];
                    if (b.Exists)
                    {
                        Building(canvas, b, id, (b.X - x0) * ppt, (b.Y - y0) * ppt, ppt);
                    }
                }
            }
        }

        canvas.Flush();
    }

    // ---------------------------------------------------------------- terrain

    /// <summary>
    /// Writes the terrain pixels: each pixel blends the colours of the four nearest tile centres with a
    /// sharpened bilinear weight (soft coasts and hills, while tiles stay readable), adds a light foam
    /// rim on the water side of shores and a fine per-pixel grain.
    /// </summary>
    private static void TerrainPixels(SKBitmap bitmap, StaticSnapshot s, int x0, int y0, int x1, int y1, int ppt)
    {
        // Tile colours for the chunk plus a one-tile border, so blending is seamless across chunks.
        int tw = x1 - x0 + 2;
        int th = y1 - y0 + 2;
        var r = new float[tw * th];
        var g = new float[tw * th];
        var b = new float[tw * th];
        var water = new float[tw * th];
        for (int ty = 0; ty < th; ty++)
        {
            int y = Math.Clamp(y0 + ty - 1, 0, s.Height - 1);
            for (int tx = 0; tx < tw; tx++)
            {
                int x = Math.Clamp(x0 + tx - 1, 0, s.Width - 1);
                int t = y * s.Width + x;
                var c = TerrainColour(s, x, y);
                if (s.Trees[t] > 0 && ppt < 6 && s.Roads[t] == RoadType.None && s.BuildingAt[t] == 0)
                {
                    // Far away, woods are a tint instead of individual crowns.
                    c = Palette.Lerp(c, Palette.Tree, 0.2 * s.Trees[t]);
                }

                int k = ty * tw + tx;
                r[k] = c.Red;
                g[k] = c.Green;
                b[k] = c.Blue;
                water[k] = s.Terrain[t] == TerrainType.Water ? 1 : 0;
            }
        }

        int width = bitmap.Width;
        int height = bitmap.Height;
        var column = new int[width];
        var columnWeight = new float[width];
        for (int px = 0; px < width; px++)
        {
            (column[px], columnWeight[px]) = Axis(px, ppt);
        }

        bool bgra = bitmap.ColorType == SKColorType.Bgra8888;
        bool foam = ppt >= 8;
        var pixels = MemoryMarshal.Cast<byte, uint>(bitmap.GetPixelSpan());
        int stride = bitmap.RowBytes / 4;
        var foamColour = Palette.Foam;
        for (int py = 0; py < height; py++)
        {
            var (row, wy) = Axis(py, ppt);
            int top = row * tw;
            int bottom = top + tw;
            int worldY = y0 * ppt + py;
            for (int px = 0; px < width; px++)
            {
                int i = column[px];
                float wx = columnWeight[px];
                float w00 = (1 - wx) * (1 - wy);
                float w10 = wx * (1 - wy);
                float w01 = (1 - wx) * wy;
                float w11 = wx * wy;
                int a = top + i;
                int c = bottom + i;
                float rr = r[a] * w00 + r[a + 1] * w10 + r[c] * w01 + r[c + 1] * w11;
                float gg = g[a] * w00 + g[a + 1] * w10 + g[c] * w01 + g[c + 1] * w11;
                float bb = b[a] * w00 + b[a + 1] * w10 + b[c] * w01 + b[c + 1] * w11;
                float wet = water[a] * w00 + water[a + 1] * w10 + water[c] * w01 + water[c + 1] * w11;

                if (foam && wet is > 0.3f and < 0.8f)
                {
                    // Light rim where water meets the shore.
                    float f = (1 - Math.Abs(wet - 0.55f) / 0.25f) * 0.55f;
                    rr += (foamColour.Red - rr) * f;
                    gg += (foamColour.Green - gg) * f;
                    bb += (foamColour.Blue - bb) * f;
                }

                uint n = Palette.Hash(x0 * ppt + px, worldY, 29);
                float grain = 1 + ((n & 0xFF) / 255f - 0.5f) * (wet > 0.5f ? 0.025f : 0.06f);
                byte red = (byte)Math.Clamp(rr * grain, 0, 255);
                byte green = (byte)Math.Clamp(gg * grain, 0, 255);
                byte blue = (byte)Math.Clamp(bb * grain, 0, 255);
                pixels[py * stride + px] = bgra
                    ? 0xFF000000u | (uint)red << 16 | (uint)green << 8 | blue
                    : 0xFF000000u | (uint)blue << 16 | (uint)green << 8 | red;
            }
        }

        bitmap.NotifyPixelsChanged();
    }

    /// <summary>
    /// For pixel <paramref name="p"/> along one axis: index of the tile centre before it (in the
    /// bordered colour array) and the sharpened weight of the next tile centre.
    /// </summary>
    private static (int Index, float Weight) Axis(int p, int ppt)
    {
        float f = (p + 0.5f) / ppt - 0.5f;
        int i = (int)MathF.Floor(f);
        float t = f - i;
        // Steeper than linear so tiles keep a flat core and blend only near their edges.
        float u = Math.Clamp((t - 0.5f) * 1.6f + 0.5f, 0, 1);
        return (i + 1, u * u * (3 - 2 * u));
    }

    public static SKColor TerrainColour(StaticSnapshot s, int x, int y)
    {
        int t = y * s.Width + x;
        int e = s.Elevation[t];
        int wl = s.WaterLevel;
        double landSpan = Math.Max(1, 255 - wl);
        SKColor c;
        switch (s.Terrain[t])
        {
            case TerrainType.Water:
                c = Palette.Lerp(Palette.ShallowWater, Palette.DeepWater, (wl - e) / 45.0);
                return Palette.Shade(c, 0.985 + (Palette.Hash(x, y, 3) & 0xFF) / 255.0 * 0.03);
            case TerrainType.Sand:
                c = Palette.Shade(Palette.Sand, 0.96 + (e - wl) / landSpan * 0.1);
                break;
            case TerrainType.Rock:
                c = Palette.Lerp(Palette.RockLow, Palette.RockHigh, (e - wl) / landSpan);
                break;
            default:
                c = Palette.Lerp(Palette.GrassLow, Palette.GrassHigh, Math.Pow((e - wl) / landSpan, 0.8));
                break;
        }

        // Hill shading: light from the north-west.
        int nw = s.Elevation[Math.Max(0, y - 1) * s.Width + Math.Max(0, x - 1)];
        int se = s.Elevation[Math.Min(s.Height - 1, y + 1) * s.Width + Math.Min(s.Width - 1, x + 1)];
        double slope = Math.Clamp((nw - se) * 0.012, -0.16, 0.16);
        double grain = ((Palette.Hash(x, y, 1) & 0xFF) / 255.0 - 0.5) * 0.04;
        return Palette.Shade(c, 1 - slope + grain);
    }

    private void Trees(SKCanvas canvas, int density, int x, int y, float px, float py, int ppt)
    {
        // Denser woods get more, larger crowns that overlap into a canopy.
        int crowns = density switch { 1 => 1, 2 => 3, _ => 4 };
        for (int i = 0; i < crowns; i++)
        {
            uint h = Palette.Hash(x, y, (uint)(11 + i));
            float fx = 0.2f + (h & 0xFF) / 255f * 0.6f;
            float fy = 0.2f + ((h >> 8) & 0xFF) / 255f * 0.6f;
            float r = ppt * (0.17f + ((h >> 16) & 0xFF) / 255f * 0.1f + density * 0.015f);
            float cxp = px + fx * ppt;
            float cyp = py + fy * ppt;
            _smooth.Color = new SKColor(0x10, 0x20, 0x08, 70);
            canvas.DrawCircle(cxp + r * 0.3f, cyp + r * 0.35f, r, _smooth);
            _smooth.Color = Palette.Shade(Palette.Tree, 0.85 + ((h >> 24) & 0xFF) / 255.0 * 0.35);
            canvas.DrawCircle(cxp, cyp, r, _smooth);
            if (ppt >= 12)
            {
                _smooth.Color = Palette.Shade(Palette.TreeLight, 0.9 + ((h >> 4) & 0xF) / 15.0 * 0.2).WithAlpha(200);
                canvas.DrawCircle(cxp - r * 0.28f, cyp - r * 0.3f, r * 0.5f, _smooth);
            }
        }
    }

    /// <summary>Empty zoned land: a light tint with an outline only along the edge of the zoned area.</summary>
    private void ZoneTint(SKCanvas canvas, StaticSnapshot s, int x, int y, float px, float py, int ppt)
    {
        var zone = s.Zones[y * s.Width + x];
        var c = Palette.ZoneColour(zone);
        _fill.Color = c.WithAlpha(48);
        canvas.DrawRect(px, py, ppt, ppt, _fill);
        if (ppt < 8)
        {
            return;
        }

        float w = Math.Max(1, ppt / 12f);
        _fill.Color = c.WithAlpha(210);
        if (!SameZone(s, x, y - 1, zone))
        {
            canvas.DrawRect(px, py, ppt, w, _fill);
        }

        if (!SameZone(s, x, y + 1, zone))
        {
            canvas.DrawRect(px, py + ppt - w, ppt, w, _fill);
        }

        if (!SameZone(s, x - 1, y, zone))
        {
            canvas.DrawRect(px, py, w, ppt, _fill);
        }

        if (!SameZone(s, x + 1, y, zone))
        {
            canvas.DrawRect(px + ppt - w, py, w, ppt, _fill);
        }

        if (ppt >= 16)
        {
            // Parcel markers.
            _fill.Color = c.WithAlpha(120);
            float d = Math.Max(1.5f, ppt / 16f);
            canvas.DrawRect(px + ppt / 2f - d / 2, py + ppt / 2f - d / 2, d, d, _fill);
        }
    }

    private static bool SameZone(StaticSnapshot s, int x, int y, ZoneType zone) =>
        (uint)x < (uint)s.Width && (uint)y < (uint)s.Height && s.Zones[y * s.Width + x] == zone;

    // ---------------------------------------------------------------- roads and lines

    private void Road(SKCanvas canvas, StaticSnapshot s, int x, int y, float px, float py, int ppt)
    {
        int t = y * s.Width + x;
        var type = s.Roads[t];
        bool n = s.IsRoad(x, y - 1);
        bool e = s.IsRoad(x + 1, y);
        bool so = s.IsRoad(x, y + 1);
        bool w = s.IsRoad(x - 1, y);
        int arms = (n ? 1 : 0) + (e ? 1 : 0) + (so ? 1 : 0) + (w ? 1 : 0);
        bool bridge = s.Terrain[t] == TerrainType.Water;
        var asphalt = type == RoadType.Avenue ? Palette.AvenueAsphalt : Palette.Asphalt;

        if (ppt < 6)
        {
            // Far away a road is a solid tile in its own colour.
            _fill.Color = type == RoadType.Avenue ? Palette.Shade(asphalt, 1.25) : Palette.Shade(asphalt, 1.45);
            canvas.DrawRect(px, py, ppt, ppt, _fill);
            return;
        }

        float half = (type == RoadType.Avenue ? 0.41f : 0.29f) * ppt;
        float curb = Math.Max(1, ppt * 0.06f);
        float c = ppt / 2f;

        if (bridge)
        {
            _fill.Color = new SKColor(0, 0, 0, 70);
            Cross(canvas, px + curb, py + curb, ppt, c, half + curb, n, e, so, w);
        }

        _fill.Color = bridge ? Palette.BridgeRail : Palette.Curb;
        Cross(canvas, px, py, ppt, c, half + curb, n, e, so, w);
        _fill.Color = asphalt;
        Cross(canvas, px, py, ppt, c, half, n, e, so, w);

        if (ppt < 10)
        {
            return;
        }

        float line = Math.Max(1, ppt / 28f);
        if (arms >= 3)
        {
            if (ppt >= 16)
            {
                Crosswalks(canvas, px, py, ppt, c, half, n, e, so, w);
            }

            return;
        }

        if (type == RoadType.Avenue)
        {
            // Double yellow centre line and dashed lane dividers.
            _fill.Color = Palette.CentreLine;
            foreach (float o in (ReadOnlySpan<float>)[-line * 1.2f, line * 1.2f])
            {
                Markings(canvas, px, py, ppt, c, o, line, n, e, so, w, dashed: false);
            }

            _fill.Color = Palette.LaneMark.WithAlpha(200);
            foreach (float o in (ReadOnlySpan<float>)[-half * 0.5f, half * 0.5f])
            {
                Markings(canvas, px, py, ppt, c, o, line, n, e, so, w, dashed: true);
            }
        }
        else
        {
            _fill.Color = Palette.LaneMark.WithAlpha(210);
            Markings(canvas, px, py, ppt, c, 0, line, n, e, so, w, dashed: true);
        }
    }

    /// <summary>A centre square plus an arm toward every connected neighbour.</summary>
    private void Cross(SKCanvas canvas, float px, float py, int ppt, float c, float half, bool n, bool e, bool s, bool w)
    {
        canvas.DrawRect(px + c - half, py + c - half, half * 2, half * 2, _fill);
        if (n)
        {
            canvas.DrawRect(px + c - half, py, half * 2, c, _fill);
        }

        if (s)
        {
            canvas.DrawRect(px + c - half, py + c, half * 2, ppt - c, _fill);
        }

        if (w)
        {
            canvas.DrawRect(px, py + c - half, c, half * 2, _fill);
        }

        if (e)
        {
            canvas.DrawRect(px + c, py + c - half, ppt - c, half * 2, _fill);
        }
    }

    /// <summary>Lines along each arm, offset from the road centre; dashes are aligned to tile edges so they continue across tiles.</summary>
    private void Markings(SKCanvas canvas, float px, float py, int ppt, float c, float offset, float width,
        bool n, bool e, bool s, bool w, bool dashed)
    {
        float dash = ppt * 0.16f;
        bool straightNs = (n || s) && !e && !w;
        bool straightEw = (e || w) && !n && !s;

        if (straightNs || (!straightEw && (n || s)))
        {
            float from = n ? 0 : c;
            float to = s ? ppt : c;
            if (straightNs)
            {
                from = 0;
                to = ppt;
            }

            Segment(canvas, px + c + offset - width / 2, py + from, width, to - from, vertical: true, dash, dashed, ppt);
        }

        if (straightEw || (!straightNs && (e || w)))
        {
            float from = w ? 0 : c;
            float to = e ? ppt : c;
            if (straightEw)
            {
                from = 0;
                to = ppt;
            }

            Segment(canvas, px + from, py + c + offset - width / 2, to - from, width, vertical: false, dash, dashed, ppt);
        }
    }

    private void Segment(SKCanvas canvas, float x, float y, float w, float h, bool vertical, float dash, bool dashed, int ppt)
    {
        if (!dashed)
        {
            canvas.DrawRect(x, y, w, h, _fill);
            return;
        }

        // Two dashes per tile, centred on the quarter points.
        float length = vertical ? h : w;
        float start = vertical ? y : x;
        float tileStart = start - (start % ppt + ppt) % ppt;
        for (float q = tileStart + ppt * 0.25f - dash / 2; q < start + length; q += ppt * 0.5f)
        {
            float a = Math.Max(q, start);
            float b = Math.Min(q + dash, start + length);
            if (b <= a)
            {
                continue;
            }

            if (vertical)
            {
                canvas.DrawRect(x, a, w, b - a, _fill);
            }
            else
            {
                canvas.DrawRect(a, y, b - a, h, _fill);
            }
        }
    }

    private void Crosswalks(SKCanvas canvas, float px, float py, int ppt, float c, float half, bool n, bool e, bool s, bool w)
    {
        // Zebra stripes just inside the junction square, one band per connected arm.
        _fill.Color = Palette.LaneMark.WithAlpha(190);
        float depth = half * 0.28f;
        float edge = Math.Max(1, ppt * 0.03f);
        float stripe = Math.Max(1, ppt / 24f);
        int count = Math.Max(2, (int)(half * 2 / (stripe * 2.2f)));
        float step = half * 2 / count;
        for (int i = 0; i < count; i++)
        {
            float o = c - half + i * step + (step - stripe) / 2;
            if (n)
            {
                canvas.DrawRect(px + o, py + c - half + edge, stripe, depth, _fill);
            }

            if (s)
            {
                canvas.DrawRect(px + o, py + c + half - edge - depth, stripe, depth, _fill);
            }

            if (w)
            {
                canvas.DrawRect(px + c - half + edge, py + o, depth, stripe, _fill);
            }

            if (e)
            {
                canvas.DrawRect(px + c + half - edge - depth, py + o, depth, stripe, _fill);
            }
        }
    }

    private void PowerLine(SKCanvas canvas, StaticSnapshot s, int x, int y, float px, float py, int ppt)
    {
        float c = ppt / 2f;
        _stroke.Color = Palette.PowerLine;
        _stroke.StrokeWidth = Math.Max(1, ppt * 0.05f);
        if (Conducts(s, x, y - 1))
        {
            canvas.DrawLine(px + c, py + c, px + c, py, _stroke);
        }

        if (Conducts(s, x, y + 1))
        {
            canvas.DrawLine(px + c, py + c, px + c, py + ppt, _stroke);
        }

        if (Conducts(s, x - 1, y))
        {
            canvas.DrawLine(px + c, py + c, px, py + c, _stroke);
        }

        if (Conducts(s, x + 1, y))
        {
            canvas.DrawLine(px + c, py + c, px + ppt, py + c, _stroke);
        }

        float pole = Math.Max(2, ppt * 0.14f);
        _fill.Color = Palette.PowerPole;
        canvas.DrawRect(px + c - pole / 2, py + c - pole / 2, pole, pole, _fill);
    }

    private static bool Conducts(StaticSnapshot s, int x, int y)
    {
        if ((uint)x >= (uint)s.Width || (uint)y >= (uint)s.Height)
        {
            return false;
        }

        int t = y * s.Width + x;
        return s.PowerLines[t] || s.BuildingAt[t] != 0;
    }

    // ---------------------------------------------------------------- buildings

    private void Building(SKCanvas canvas, BuildingVisual b, int id, float px, float py, int ppt)
    {
        float size = b.Size * ppt;
        var lot = new SKRect(px, py, px + size, py + size);
        canvas.Save();
        canvas.ClipRect(lot);
        try
        {
            if (b.Look.HasFlag(BuildingLook.UnderConstruction))
            {
                Construction(canvas, lot, ppt);
                return;
            }

            if (ppt < 6)
            {
                _fill.Color = b.Look.HasFlag(BuildingLook.Abandoned) ? Palette.Abandoned : Palette.BuildingColour(b.Kind, b.Level);
                float m = ppt >= 4 ? 1 : 0;
                canvas.DrawRect(lot.Left + m, lot.Top + m, lot.Width - m * 2, lot.Height - m * 2, _fill);
                return;
            }

            if (b.Kind.IsZoned())
            {
                Zoned(canvas, b, id, lot, ppt);
            }
            else
            {
                Service(canvas, b, lot, ppt);
            }

            if (b.Look.HasFlag(BuildingLook.Abandoned))
            {
                Ruin(canvas, lot, id, ppt);
            }
        }
        finally
        {
            canvas.Restore();
        }
    }

    private void Construction(SKCanvas canvas, SKRect lot, int ppt)
    {
        float m = lot.Width * 0.06f;
        _fill.Color = Palette.ConstructionLot;
        canvas.DrawRect(lot.Left + m, lot.Top + m, lot.Width - m * 2, lot.Height - m * 2, _fill);
        if (ppt < 8)
        {
            return;
        }

        // Scaffolding: a frame with diagonal bracing.
        var frame = new SKRect(lot.Left + lot.Width * 0.2f, lot.Top + lot.Height * 0.2f, lot.Right - lot.Width * 0.2f, lot.Bottom - lot.Height * 0.2f);
        _stroke.Color = Palette.Scaffold;
        _stroke.StrokeWidth = Math.Max(1, ppt / 20f);
        canvas.DrawRect(frame, _stroke);
        canvas.DrawLine(frame.Left, frame.Top, frame.Right, frame.Bottom, _stroke);
        canvas.DrawLine(frame.Right, frame.Top, frame.Left, frame.Bottom, _stroke);
        _fill.Color = new SKColor(0xF0, 0xA0, 0x20);
        float cone = Math.Max(1.5f, ppt * 0.07f);
        canvas.DrawRect(lot.Left + m * 1.5f, lot.Bottom - m * 1.5f - cone, cone, cone, _fill);
    }

    private void Zoned(SKCanvas canvas, BuildingVisual b, int id, SKRect lot, int ppt)
    {
        uint h = Palette.Hash(b.X, b.Y, (uint)id);
        bool abandoned = b.Look.HasFlag(BuildingLook.Abandoned);
        int level = Math.Clamp((int)b.Level, 1, 3);

        // Lot surface: lawn for homes, paving for shops and factories.
        if (b.Kind != BuildingKind.Residential)
        {
            _fill.Color = b.Kind == BuildingKind.Commercial ? new SKColor(0xB8, 0xB6, 0xB0) : new SKColor(0xA8, 0xA2, 0x96);
            canvas.DrawRect(lot, _fill);
        }
        else if (level == 3)
        {
            _fill.Color = new SKColor(0xA6, 0xB4, 0x96);
            canvas.DrawRect(lot, _fill);
        }

        float inset = lot.Width * (level switch { 1 => 0.14f, 2 => 0.1f, _ => 0.05f });
        // Per-building footprint variation so a street of houses is not a row of clones.
        float jx = ((h & 0xF) / 15f - 0.5f) * lot.Width * 0.05f;
        float jy = (((h >> 4) & 0xF) / 15f - 0.5f) * lot.Width * 0.05f;
        var body = new SKRect(lot.Left + inset + jx, lot.Top + inset + jy, lot.Right - inset + jx, lot.Bottom - inset + jy);
        if (b.Kind == BuildingKind.Residential && level == 1)
        {
            // Houses are oblong, with a garden on one side.
            float garden = lot.Width * 0.14f;
            body = (h & 0x200) != 0
                ? new SKRect(body.Left, body.Top + garden * 0.5f, body.Right, body.Bottom - garden * 0.5f)
                : new SKRect(body.Left + garden * 0.5f, body.Top, body.Right - garden * 0.5f, body.Bottom);
        }
        float height = lot.Width * (0.04f + level * 0.045f);

        _fill.Color = Palette.Shadow;
        canvas.DrawRect(body.Left + height, body.Top + height, body.Width, body.Height, _fill);

        var colour = abandoned ? Palette.Abandoned : Palette.Shade(Palette.BuildingColour(b.Kind, level), 0.94 + ((h >> 8) & 0xFF) / 255.0 * 0.12);
        Box(canvas, body, colour, ppt);

        if (ppt < 12 || abandoned)
        {
            return;
        }

        switch (b.Kind)
        {
            case BuildingKind.Residential:
                ResidentialRoof(canvas, body, colour, level, h, ppt);
                break;
            case BuildingKind.Commercial:
                CommercialRoof(canvas, body, colour, level, h, ppt);
                break;
            default:
                IndustrialRoof(canvas, body, colour, level);
                break;
        }
    }

    /// <summary>Flat-shaded block with a light top-left and dark bottom-right bevel.</summary>
    private void Box(SKCanvas canvas, SKRect body, SKColor colour, int ppt)
    {
        _fill.Color = colour;
        canvas.DrawRect(body, _fill);
        if (ppt < 8)
        {
            return;
        }

        float bevel = Math.Max(1, ppt * 0.04f);
        _fill.Color = Palette.Shade(colour, 1.18);
        canvas.DrawRect(body.Left, body.Top, body.Width, bevel, _fill);
        canvas.DrawRect(body.Left, body.Top, bevel, body.Height, _fill);
        _fill.Color = Palette.Shade(colour, 0.72);
        canvas.DrawRect(body.Left, body.Bottom - bevel, body.Width, bevel, _fill);
        canvas.DrawRect(body.Right - bevel, body.Top, bevel, body.Height, _fill);
    }

    private void ResidentialRoof(SKCanvas canvas, SKRect body, SKColor colour, int level, uint h, int ppt)
    {
        if (level < 3)
        {
            // Pitched roof: two halves in different light with a ridge.
            bool ridgeHorizontal = (h & 0x100) != 0;
            _fill.Color = Palette.Shade(colour, 0.82);
            if (ridgeHorizontal)
            {
                canvas.DrawRect(body.Left, body.MidY, body.Width, body.Height / 2, _fill);
            }
            else
            {
                canvas.DrawRect(body.MidX, body.Top, body.Width / 2, body.Height, _fill);
            }

            _stroke.Color = Palette.Shade(colour, 0.6);
            _stroke.StrokeWidth = Math.Max(1, ppt / 24f);
            if (ridgeHorizontal)
            {
                canvas.DrawLine(body.Left, body.MidY, body.Right, body.MidY, _stroke);
            }
            else
            {
                canvas.DrawLine(body.MidX, body.Top, body.MidX, body.Bottom, _stroke);
            }

            if (level == 2)
            {
                float chimney = body.Width * 0.14f;
                _fill.Color = new SKColor(0x8A, 0x50, 0x40);
                canvas.DrawRect(body.Right - chimney * 2, body.Top + chimney, chimney, chimney, _fill);
            }

            return;
        }

        // Apartment block: parapet and a grid of skylights.
        Parapet(canvas, body, colour);
        _fill.Color = new SKColor(0xD8, 0xE8, 0xF0, 200);
        float cell = body.Width / 4;
        for (int i = 0; i < 3; i++)
        {
            for (int j = 0; j < 3; j++)
            {
                if (((h >> (i * 3 + j)) & 1) == 0)
                {
                    continue;
                }

                canvas.DrawRect(body.Left + cell * (0.7f + i), body.Top + cell * (0.7f + j), cell * 0.5f, cell * 0.5f, _fill);
            }
        }
    }

    private void CommercialRoof(SKCanvas canvas, SKRect body, SKColor colour, int level, uint h, int ppt)
    {
        Parapet(canvas, body, colour);
        // Rooftop units.
        _fill.Color = new SKColor(0xDC, 0xDE, 0xE0);
        float unit = body.Width * 0.16f;
        int count = level + 1;
        for (int i = 0; i < count; i++)
        {
            uint k = h >> (i * 5);
            float ux = body.Left + body.Width * (0.2f + (k & 0x7) / 7f * 0.5f);
            float uy = body.Top + body.Height * (0.2f + ((k >> 3) & 0x3) / 3f * 0.5f);
            canvas.DrawRect(ux, uy, unit, unit * 0.8f, _fill);
        }

        if (level == 3)
        {
            // Glass tower sheen.
            _fill.Color = new SKColor(0xFF, 0xFF, 0xFF, 50);
            using var path = new SKPath();
            path.MoveTo(body.Left, body.Bottom);
            path.LineTo(body.Left, body.Top + body.Height * 0.4f);
            path.LineTo(body.Left + body.Width * 0.4f, body.Top);
            path.LineTo(body.Left + body.Width * 0.6f, body.Top);
            path.Close();
            canvas.DrawPath(path, _fill);
        }
    }

    private void IndustrialRoof(SKCanvas canvas, SKRect body, SKColor colour, int level)
    {
        // Saw-tooth roof stripes.
        _fill.Color = Palette.Shade(colour, 0.78);
        int stripes = 3 + level;
        float step = body.Height / stripes;
        for (int i = 0; i < stripes; i++)
        {
            canvas.DrawRect(body.Left, body.Top + i * step, body.Width, step * 0.35f, _fill);
        }

        if (level >= 2)
        {
            float r = body.Width * 0.12f;
            float cxp = body.Right - r * 1.6f;
            float cyp = body.Top + r * 1.6f;
            _smooth.Color = new SKColor(0x70, 0x6A, 0x64);
            canvas.DrawCircle(cxp, cyp, r, _smooth);
            _smooth.Color = new SKColor(0x2A, 0x26, 0x24);
            canvas.DrawCircle(cxp, cyp, r * 0.55f, _smooth);
        }
    }

    private void Parapet(SKCanvas canvas, SKRect body, SKColor colour)
    {
        float p = Math.Max(1, body.Width * 0.08f);
        _fill.Color = Palette.Shade(colour, 0.88);
        canvas.DrawRect(body.Left + p, body.Top + p, body.Width - p * 2, body.Height - p * 2, _fill);
    }

    private void Ruin(SKCanvas canvas, SKRect lot, int id, int ppt)
    {
        _fill.Color = new SKColor(0x30, 0x2A, 0x26, 70);
        canvas.DrawRect(lot, _fill);
        if (ppt < 10)
        {
            return;
        }

        uint h = Palette.Hash(id, 5, 99);
        _stroke.Color = Palette.AbandonedDark;
        _stroke.StrokeWidth = Math.Max(1, ppt / 18f);
        float l = lot.Left;
        float t = lot.Top;
        float s = lot.Width;
        canvas.DrawLine(l + s * 0.25f, t + s * 0.3f, l + s * 0.55f, t + s * 0.55f, _stroke);
        canvas.DrawLine(l + s * 0.55f, t + s * 0.55f, l + s * (0.7f + (h & 3) * 0.04f), t + s * 0.8f, _stroke);
        _fill.Color = Palette.AbandonedDark;
        canvas.DrawRect(l + s * 0.62f, t + s * 0.28f, s * 0.12f, s * 0.1f, _fill);
    }

    private void Service(SKCanvas canvas, BuildingVisual b, SKRect lot, int ppt)
    {
        var colour = b.Look.HasFlag(BuildingLook.Abandoned) ? Palette.Abandoned : Palette.BuildingColour(b.Kind, 1);
        float s = lot.Width;
        float m = s * (b.Size == 1 ? 0.1f : 0.06f);
        var body = new SKRect(lot.Left + m, lot.Top + m, lot.Right - m, lot.Bottom - m);
        float tile = ppt;

        switch (b.Kind)
        {
            case BuildingKind.WindTurbine:
                _smooth.Color = new SKColor(0xB8, 0xB4, 0xAC);
                canvas.DrawCircle(lot.MidX, lot.MidY, s * 0.22f, _smooth);
                _smooth.Color = colour;
                canvas.DrawCircle(lot.MidX, lot.MidY, s * 0.1f, _smooth);
                return;
            case BuildingKind.WaterTower:
                _smooth.Color = Palette.Shadow;
                canvas.DrawCircle(lot.MidX + s * 0.08f, lot.MidY + s * 0.08f, s * 0.36f, _smooth);
                _smooth.Color = colour;
                canvas.DrawCircle(lot.MidX, lot.MidY, s * 0.36f, _smooth);
                _stroke.Color = Palette.Shade(colour, 0.7);
                _stroke.StrokeWidth = Math.Max(1, s * 0.05f);
                canvas.DrawCircle(lot.MidX, lot.MidY, s * 0.24f, _stroke);
                return;
        }

        _fill.Color = Palette.Shadow;
        canvas.DrawRect(body.Left + tile * 0.12f, body.Top + tile * 0.12f, body.Width, body.Height, _fill);
        Box(canvas, body, colour, ppt);
        if (ppt < 8)
        {
            return;
        }

        switch (b.Kind)
        {
            case BuildingKind.CoalPlant:
                // Coal heap and two smoke stacks.
                _smooth.Color = new SKColor(0x22, 0x22, 0x24);
                canvas.DrawOval(body.Left + body.Width * 0.3f, body.Bottom - body.Height * 0.25f, body.Width * 0.2f, body.Height * 0.12f, _smooth);
                Stack(canvas, body.Right - tile * 0.8f, body.Top + tile * 0.8f, tile * 0.42f);
                Stack(canvas, body.Right - tile * 1.8f, body.Top + tile * 0.8f, tile * 0.42f);
                break;
            case BuildingKind.Incinerator:
                Stack(canvas, body.Right - tile * 0.55f, body.Top + tile * 0.55f, tile * 0.32f);
                _smooth.Color = new SKColor(0xFF, 0x90, 0x30, 200);
                canvas.DrawCircle(body.Left + body.Width * 0.3f, body.Bottom - body.Height * 0.3f, tile * 0.16f, _smooth);
                break;
            case BuildingKind.WaterPump:
                _fill.Color = Palette.ShallowWater;
                canvas.DrawRoundRect(body.Left + body.Width * 0.18f, body.Top + body.Height * 0.18f, body.Width * 0.64f, body.Height * 0.4f, tile * 0.1f, tile * 0.1f, _fill);
                _fill.Color = new SKColor(0x40, 0x50, 0x60);
                canvas.DrawRect(body.MidX - tile * 0.06f, body.Top + body.Height * 0.58f, tile * 0.12f, body.Height * 0.3f, _fill);
                break;
            case BuildingKind.Landfill:
                foreach (var (fx, fy, fr) in (ReadOnlySpan<(float, float, float)>)[(0.3f, 0.32f, 0.2f), (0.65f, 0.4f, 0.24f), (0.42f, 0.7f, 0.18f)])
                {
                    _smooth.Color = new SKColor(0x6A, 0x5C, 0x3C);
                    canvas.DrawCircle(body.Left + body.Width * fx, body.Top + body.Height * fy, body.Width * fr, _smooth);
                    _smooth.Color = new SKColor(0x9C, 0x8C, 0x60);
                    canvas.DrawCircle(body.Left + body.Width * (fx - 0.04f), body.Top + body.Height * (fy - 0.04f), body.Width * fr * 0.5f, _smooth);
                }

                _stroke.Color = new SKColor(0x50, 0x44, 0x30);
                _stroke.StrokeWidth = Math.Max(1, tile / 16f);
                canvas.DrawRect(body, _stroke);
                break;
            case BuildingKind.FireStation:
                _fill.Color = new SKColor(0xF4, 0xF0, 0xE8);
                float door = body.Width / 4;
                for (int i = 0; i < 3; i++)
                {
                    canvas.DrawRect(body.Left + door * (0.35f + i * 1.15f), body.Bottom - body.Height * 0.28f, door * 0.8f, body.Height * 0.2f, _fill);
                }

                _fill.Color = new SKColor(0xF4, 0xF0, 0xE8, 220);
                canvas.DrawRect(body.Left + body.Width * 0.15f, body.Top + body.Height * 0.2f, body.Width * 0.7f, body.Height * 0.1f, _fill);
                break;
            case BuildingKind.Clinic:
                _fill.Color = new SKColor(0xD8, 0x30, 0x30);
                float arm = body.Width * 0.14f;
                canvas.DrawRect(body.MidX - arm / 2, body.MidY - arm * 1.6f, arm, arm * 3.2f, _fill);
                canvas.DrawRect(body.MidX - arm * 1.6f, body.MidY - arm / 2, arm * 3.2f, arm, _fill);
                break;
        }
    }

    private void Stack(SKCanvas canvas, float cx, float cy, float r)
    {
        _smooth.Color = new SKColor(0x9A, 0x9C, 0xA0);
        canvas.DrawCircle(cx, cy, r, _smooth);
        _smooth.Color = new SKColor(0xC8, 0x50, 0x40);
        canvas.DrawCircle(cx, cy, r * 0.8f, _smooth);
        _smooth.Color = new SKColor(0x9A, 0x9C, 0xA0);
        canvas.DrawCircle(cx, cy, r * 0.62f, _smooth);
        _smooth.Color = new SKColor(0x20, 0x20, 0x22);
        canvas.DrawCircle(cx, cy, r * 0.45f, _smooth);
    }
}
