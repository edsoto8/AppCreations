using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Rendering;

public enum OverlayKind
{
    None = 0,
    Traffic,
    Electricity,
    Water,
    Zoning,
    Population,
    LandValue,
    Pollution,
    Garbage,
    Fire,
    Health,
}

/// <summary>One legend entry shown under the overlay selector.</summary>
public sealed record LegendEntry(SKColor Colour, string Label);

/// <summary>Static description of an overlay: title, hotkey label and legend.</summary>
public sealed record OverlayInfo(OverlayKind Kind, string Title, string Hotkey, IReadOnlyList<LegendEntry> Legend)
{
    public static readonly IReadOnlyList<OverlayInfo> All =
    [
        new(OverlayKind.None, "No overlay", "`", []),
        new(OverlayKind.Traffic, "Traffic", "Shift+1", [new(Palette.Heat(0), "free"), new(Palette.Heat(0.5), "busy"), new(Palette.Heat(1), "jammed")]),
        new(OverlayKind.Electricity, "Electricity", "Shift+2", [new(OverlayBuilder.Powered, "powered"), new(OverlayBuilder.Missing, "no power"), new(OverlayBuilder.Producer, "plant / line")]),
        new(OverlayKind.Water, "Water", "Shift+3", [new(OverlayBuilder.Watered, "watered"), new(OverlayBuilder.Missing, "no water"), new(OverlayBuilder.WaterSource, "pump / tower")]),
        new(OverlayKind.Zoning, "Zoning", "Shift+4", [new(Palette.ResidentialZone, "residential"), new(Palette.CommercialZone, "commercial"), new(Palette.IndustrialZone, "industrial"), new(OverlayBuilder.Service, "service")]),
        new(OverlayKind.Population, "Occupancy", "Shift+5", [new(Palette.Heat(0), "empty"), new(Palette.Heat(0.5), "half"), new(Palette.Heat(1), "full")]),
        new(OverlayKind.LandValue, "Land value", "Shift+6", [new(Palette.Value(0), "low"), new(Palette.Value(0.5), "medium"), new(Palette.Value(1), "high")]),
        new(OverlayKind.Pollution, "Pollution", "Shift+7", [new(OverlayBuilder.PollutionColour(40), "light"), new(OverlayBuilder.PollutionColour(140), "heavy"), new(OverlayBuilder.PollutionColour(255), "toxic")]),
        new(OverlayKind.Garbage, "Garbage", "Shift+8", [new(Palette.Heat(0), "clean"), new(Palette.Heat(1), "piling up"), new(OverlayBuilder.Covered, "collection route"), new(OverlayBuilder.WaterSource, "landfill / incinerator")]),
        new(OverlayKind.Fire, "Fire coverage", "Shift+9", [new(OverlayBuilder.FireCover, "covered"), new(OverlayBuilder.Missing, "not covered"), new(OverlayBuilder.Burning, "burning")]),
        new(OverlayKind.Health, "Health coverage", "Shift+0", [new(OverlayBuilder.HealthCover, "covered"), new(OverlayBuilder.Missing, "not covered")]),
    ];

    public static OverlayInfo Of(OverlayKind kind) => All[(int)kind];
}

/// <summary>
/// One overlay as a 1-pixel-per-tile image (0xAARRGGBB, premultiplied). Immutable once built; the
/// renderer uploads it to an <see cref="SKImage"/> once per <see cref="Version"/> and stretches it over
/// the map, which costs the same at any zoom level.
/// </summary>
public sealed class OverlayLayer
{
    public required OverlayKind Kind { get; init; }

    public required int Width { get; init; }

    public required int Height { get; init; }

    public required uint[] Pixels { get; init; }

    public required int Version { get; init; }

    /// <summary>Bilinear filtering for continuous fields (land value, pollution), nearest for tile data.</summary>
    public bool Smooth { get; init; }

    /// <summary>Opacity of the darkening veil drawn over the map before the overlay (0..1).</summary>
    public float Dim { get; init; } = 0.45f;
}

/// <summary>Builds overlay layers from live state. Call with the state lock held (UI thread).</summary>
public static class OverlayBuilder
{
    public static readonly SKColor Powered = new(0x5C, 0xD6, 0x5C);
    public static readonly SKColor Missing = new(0xE8, 0x3A, 0x34);
    public static readonly SKColor Producer = new(0xFF, 0xD8, 0x30);
    public static readonly SKColor Watered = new(0x48, 0xA8, 0xF0);
    public static readonly SKColor WaterSource = new(0x60, 0xF0, 0xF0);
    public static readonly SKColor Service = new(0xB0, 0x78, 0xE0);
    public static readonly SKColor Covered = new(0x70, 0xC8, 0x80);
    public static readonly SKColor FireCover = new(0xF0, 0x8C, 0x3C);
    public static readonly SKColor HealthCover = new(0x40, 0xD0, 0xC0);
    public static readonly SKColor Burning = new(0xFF, 0x30, 0x10);
    public static readonly SKColor Pending = new(0x90, 0x90, 0x90);

    private static readonly SKColor Pipe = new(0x40, 0x70, 0xA0);

    public static SKColor PollutionColour(int value)
    {
        double t = value / 255.0;
        var c = Palette.Lerp(new SKColor(0xC8, 0xB0, 0x40), new SKColor(0x90, 0x20, 0x60), t);
        return c.WithAlpha((byte)Math.Clamp(60 + t * 195, 0, 230));
    }

    /// <summary>True when the overlay changes every tick (rebuilt at a capped rate), not only hourly.</summary>
    public static bool IsLive(OverlayKind kind) => kind is OverlayKind.Traffic or OverlayKind.Fire;

    public static OverlayLayer? Build(Simulation sim, OverlayKind kind, int version)
    {
        if (kind == OverlayKind.None)
        {
            return null;
        }

        var map = sim.Map;
        var pixels = new uint[map.TileCount];
        bool smooth = false;
        float dim = 0.5f;
        switch (kind)
        {
            case OverlayKind.Traffic:
                Traffic(sim, pixels);
                break;
            case OverlayKind.Electricity:
                Electricity(sim, pixels);
                break;
            case OverlayKind.Water:
                Water(sim, pixels);
                break;
            case OverlayKind.Zoning:
                Zoning(sim, pixels);
                dim = 0.35f;
                break;
            case OverlayKind.Population:
                Population(sim, pixels);
                break;
            case OverlayKind.LandValue:
                // Land value mostly sits in 40..200; stretch that range over the colour ramp.
                Field(map, map.LandValue, pixels, v => Palette.Value((v - 40) / 160.0).WithAlpha(200), skipWater: true);
                smooth = true;
                dim = 0.3f;
                break;
            case OverlayKind.Pollution:
                Field(map, map.Pollution, pixels, v => v < 6 ? SKColors.Transparent : PollutionColour(v), skipWater: false);
                smooth = true;
                dim = 0.3f;
                break;
            case OverlayKind.Garbage:
                Garbage(sim, pixels);
                break;
            case OverlayKind.Fire:
                Coverage(sim, pixels, bit: 1, FireCover, b => b.CoveredByFire, showBurning: true, BuildingKind.FireStation);
                break;
            case OverlayKind.Health:
                Coverage(sim, pixels, bit: 2, HealthCover, b => b.CoveredByHealth, showBurning: false, BuildingKind.Clinic);
                break;
        }

        return new OverlayLayer
        {
            Kind = kind,
            Width = map.Width,
            Height = map.Height,
            Pixels = pixels,
            Version = version,
            Smooth = smooth,
            Dim = dim,
        };
    }

    private static void Traffic(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        var traffic = sim.Traffic;
        var volume = traffic.VolumeLastHour;
        for (int t = 0; t < pixels.Length; t++)
        {
            var road = map.Roads[t];
            if (road != RoadType.None)
            {
                // Lane load is instantaneous; last hour's volume (relative to what the lanes can carry)
                // keeps busy corridors visible between rush hours.
                double load = traffic.LaneLoadPercent(t) / 100.0;
                double flow = t < volume.Length ? volume[t] / (60.0 * Core.Roads.RoadSpecs.LaneCapacity(road)) : 0;
                pixels[t] = Palette.Pack(Palette.Heat(Math.Max(load, flow * 0.8)).WithAlpha(235));
            }
        }
    }

    private static void Electricity(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        uint line = Palette.Pack(Producer.WithAlpha(150));
        for (int t = 0; t < pixels.Length; t++)
        {
            if (map.PowerLines[t])
            {
                pixels[t] = line;
            }
        }

        foreach (var b in sim.Buildings)
        {
            SKColor c = b.Spec.PowerOutput > 0 ? Producer
                : !b.IsComplete ? Pending
                : b.PowerUse == 0 ? Pending
                : b.Powered ? Powered : Missing;
            Fill(map, pixels, b, c.WithAlpha(230));
        }
    }

    private static void Water(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        uint pipe = Palette.Pack(Pipe.WithAlpha(150));
        for (int t = 0; t < pixels.Length; t++)
        {
            if (map.Roads[t] != RoadType.None)
            {
                pixels[t] = pipe;
            }
        }

        foreach (var b in sim.Buildings)
        {
            SKColor c = b.Spec.WaterOutput > 0 ? WaterSource
                : !b.IsComplete ? Pending
                : b.WaterUse == 0 ? Pending
                : b.Watered ? Watered : Missing;
            Fill(map, pixels, b, c.WithAlpha(230));
        }
    }

    private static void Zoning(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        for (int t = 0; t < pixels.Length; t++)
        {
            var zone = map.Zones[t];
            if (zone != ZoneType.None)
            {
                pixels[t] = Palette.Pack(Palette.ZoneColour(zone).WithAlpha(map.BuildingAt[t] != 0 ? (byte)230 : (byte)150));
            }
        }

        foreach (var b in sim.Buildings)
        {
            if (!b.Kind.IsZoned())
            {
                Fill(map, pixels, b, Service.WithAlpha(220));
            }
        }
    }

    private static void Population(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        foreach (var b in sim.Buildings)
        {
            if (!b.Kind.IsZoned())
            {
                continue;
            }

            int capacity = Math.Max(1, ZoneLevels.Capacity(b.Kind, b.Level));
            int occupants = b.Kind == BuildingKind.Residential ? b.Residents : b.Workers;
            var c = b.Abandoned ? Missing.WithAlpha(120) : Palette.Heat(occupants / (double)capacity).WithAlpha(230);
            Fill(map, pixels, b, c);
        }
    }

    private static void Garbage(Simulation sim, uint[] pixels)
    {
        var map = sim.Map;
        var coverage = sim.ServiceCoverage;
        uint route = Palette.Pack(Covered.WithAlpha(110));
        for (int t = 0; t < pixels.Length && t < coverage.Length; t++)
        {
            if ((coverage[t] & 4) != 0)
            {
                pixels[t] = route;
            }
        }

        foreach (var b in sim.Buildings)
        {
            SKColor c = b.Spec.Category == ServiceCategory.Garbage ? WaterSource
                : !b.IsComplete ? Pending
                : Palette.Heat(b.Garbage / 60.0);
            Fill(map, pixels, b, c.WithAlpha(230));
        }
    }

    private static void Coverage(Simulation sim, uint[] pixels, int bit, SKColor cover, Func<Building, bool> covered,
        bool showBurning, BuildingKind station)
    {
        var map = sim.Map;
        var coverage = sim.ServiceCoverage;
        uint road = Palette.Pack(cover.WithAlpha(120));
        for (int t = 0; t < pixels.Length && t < coverage.Length; t++)
        {
            if ((coverage[t] & bit) != 0)
            {
                pixels[t] = road;
            }
        }

        foreach (var b in sim.Buildings)
        {
            SKColor c = showBurning && b.IsBurning ? Burning
                : b.Kind == station ? Producer
                : covered(b) ? cover : Missing;
            Fill(map, pixels, b, c.WithAlpha(225));
        }
    }

    private static void Field(CityMap map, byte[] values, uint[] pixels, Func<int, SKColor> colour, bool skipWater)
    {
        // Values only take 256 levels: build the colour lookup once.
        Span<uint> lut = stackalloc uint[256];
        for (int v = 0; v < 256; v++)
        {
            lut[v] = Palette.Pack(colour(v));
        }

        for (int t = 0; t < pixels.Length; t++)
        {
            if (!skipWater || map.Terrain[t] != TerrainType.Water)
            {
                pixels[t] = lut[values[t]];
            }
        }
    }

    private static void Fill(CityMap map, uint[] pixels, Building b, SKColor c)
    {
        uint packed = Palette.Pack(c);
        for (int y = b.Y; y < b.Y + b.Size; y++)
        {
            for (int x = b.X; x < b.X + b.Size; x++)
            {
                pixels[map.Index(x, y)] = packed;
            }
        }
    }
}
