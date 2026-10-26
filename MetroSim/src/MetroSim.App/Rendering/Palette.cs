using MetroSim.Core.Buildings;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Rendering;

/// <summary>Map colours. Kept in one place so the overlays, legend and renderer agree.</summary>
public static class Palette
{
    public static readonly SKColor Background = new(0x14, 0x1A, 0x22);

    // Terrain.
    public static readonly SKColor ShallowWater = new(0x4A, 0x8F, 0xC2);
    public static readonly SKColor DeepWater = new(0x1C, 0x46, 0x78);
    public static readonly SKColor Foam = new(0xA8, 0xD4, 0xEE);
    public static readonly SKColor Sand = new(0xDB, 0xC9, 0x93);
    public static readonly SKColor GrassLow = new(0x5E, 0x8F, 0x3E);
    public static readonly SKColor GrassHigh = new(0x93, 0xA8, 0x5A);
    public static readonly SKColor RockLow = new(0x86, 0x80, 0x78);
    public static readonly SKColor RockHigh = new(0xB5, 0xAF, 0xA6);
    public static readonly SKColor Tree = new(0x2F, 0x5A, 0x2A);
    public static readonly SKColor TreeLight = new(0x4E, 0x7F, 0x3A);

    // Roads.
    public static readonly SKColor Curb = new(0xB9, 0xB5, 0xAC);
    public static readonly SKColor Asphalt = new(0x4B, 0x4F, 0x55);
    public static readonly SKColor AvenueAsphalt = new(0x3F, 0x43, 0x49);
    public static readonly SKColor LaneMark = new(0xE8, 0xE8, 0xE0);
    public static readonly SKColor CentreLine = new(0xE8, 0xC2, 0x3A);
    public static readonly SKColor BridgeRail = new(0xD6, 0xD2, 0xC8);
    public static readonly SKColor PowerLine = new(0x2B, 0x2B, 0x2E);
    public static readonly SKColor PowerPole = new(0x6B, 0x4E, 0x2E);

    // Zones (empty zoned land tint) and zoned buildings by level.
    public static readonly SKColor ResidentialZone = new(0x58, 0xC0, 0x5A);
    public static readonly SKColor CommercialZone = new(0x4A, 0x8E, 0xE0);
    public static readonly SKColor IndustrialZone = new(0xE0, 0xB0, 0x3A);

    public static readonly SKColor[] Residential = [new(0x9C, 0xD0, 0x7E), new(0x6E, 0xB8, 0x6A), new(0x3F, 0x9A, 0x5E)];
    public static readonly SKColor[] Commercial = [new(0x8F, 0xB8, 0xE8), new(0x5F, 0x95, 0xD8), new(0x38, 0x6E, 0xC0)];
    public static readonly SKColor[] Industrial = [new(0xE6, 0xC4, 0x6A), new(0xD4, 0xA2, 0x3E), new(0xB8, 0x80, 0x2C)];

    public static readonly SKColor ConstructionLot = new(0xA0, 0x80, 0x58);
    public static readonly SKColor Scaffold = new(0xE8, 0xD8, 0xB0);
    public static readonly SKColor Abandoned = new(0x7A, 0x72, 0x6A);
    public static readonly SKColor AbandonedDark = new(0x3E, 0x38, 0x34);
    public static readonly SKColor Shadow = new(0x00, 0x00, 0x00, 0x48);

    // Vehicles.
    public static readonly SKColor[] CarColours =
    [
        new(0xF2, 0xF2, 0xF2), new(0x2E, 0x5E, 0xAA), new(0xC8, 0x3A, 0x3A), new(0x30, 0x30, 0x34),
        new(0xE8, 0xC0, 0x40), new(0x7A, 0x8A, 0x96), new(0x3A, 0x8A, 0x5A), new(0xD8, 0x7A, 0x34),
    ];

    public static readonly SKColor FireTruck = new(0xE0, 0x24, 0x1C);
    public static readonly SKColor Pedestrian = new(0xFF, 0xE8, 0xC8);

    public static SKColor ZoneColour(ZoneType zone) => zone switch
    {
        ZoneType.Residential => ResidentialZone,
        ZoneType.Commercial => CommercialZone,
        ZoneType.Industrial => IndustrialZone,
        _ => SKColors.Transparent,
    };

    public static SKColor BuildingColour(BuildingKind kind, int level)
    {
        int i = Math.Clamp(level, 1, 3) - 1;
        return kind switch
        {
            BuildingKind.Residential => Residential[i],
            BuildingKind.Commercial => Commercial[i],
            BuildingKind.Industrial => Industrial[i],
            BuildingKind.CoalPlant => new SKColor(0x5A, 0x5E, 0x64),
            BuildingKind.WindTurbine => new SKColor(0xD8, 0xDE, 0xE4),
            BuildingKind.WaterPump => new SKColor(0x7E, 0x9C, 0xB0),
            BuildingKind.WaterTower => new SKColor(0x9C, 0xC8, 0xE2),
            BuildingKind.Landfill => new SKColor(0x8C, 0x7A, 0x52),
            BuildingKind.Incinerator => new SKColor(0x8E, 0x4C, 0x3C),
            BuildingKind.FireStation => new SKColor(0xC8, 0x42, 0x3A),
            BuildingKind.Clinic => new SKColor(0xEE, 0xF0, 0xF2),
            _ => SKColors.Magenta,
        };
    }

    public static SKColor Lerp(SKColor a, SKColor b, double t)
    {
        t = Math.Clamp(t, 0, 1);
        return new SKColor(
            (byte)(a.Red + (b.Red - a.Red) * t),
            (byte)(a.Green + (b.Green - a.Green) * t),
            (byte)(a.Blue + (b.Blue - a.Blue) * t),
            (byte)(a.Alpha + (b.Alpha - a.Alpha) * t));
    }

    /// <summary>Multiplies brightness by <paramref name="factor"/> (1 = unchanged).</summary>
    public static SKColor Shade(SKColor c, double factor) => new(
        (byte)Math.Clamp(c.Red * factor, 0, 255),
        (byte)Math.Clamp(c.Green * factor, 0, 255),
        (byte)Math.Clamp(c.Blue * factor, 0, 255),
        c.Alpha);

    /// <summary>
    /// Packs a colour premultiplied as 0xAARRGGBB, which is BGRA byte order in memory on little-endian
    /// machines (the overlay image format).
    /// </summary>
    public static uint Pack(SKColor c)
    {
        uint a = c.Alpha;
        return a << 24 | (c.Red * a / 255) << 16 | (c.Green * a / 255) << 8 | c.Blue * a / 255;
    }

    /// <summary>Green → yellow → red for 0..1 (traffic load, garbage).</summary>
    public static SKColor Heat(double t)
    {
        t = Math.Clamp(t, 0, 1);
        var green = new SKColor(0x3C, 0xC0, 0x58);
        var yellow = new SKColor(0xF2, 0xD0, 0x3A);
        var red = new SKColor(0xE8, 0x34, 0x2C);
        return t < 0.5 ? Lerp(green, yellow, t * 2) : Lerp(yellow, red, (t - 0.5) * 2);
    }

    /// <summary>Perceptual-ish ramp dark blue → teal → yellow for 0..1 (land value).</summary>
    public static SKColor Value(double t)
    {
        t = Math.Clamp(t, 0, 1);
        var low = new SKColor(0x30, 0x24, 0x68);
        var mid = new SKColor(0x22, 0x9C, 0x8C);
        var high = new SKColor(0xF4, 0xE0, 0x4C);
        return t < 0.5 ? Lerp(low, mid, t * 2) : Lerp(mid, high, (t - 0.5) * 2);
    }

    /// <summary>Stable small hash of a tile, for per-tile variation that never flickers.</summary>
    public static uint Hash(int x, int y, uint salt = 0)
    {
        uint h = (uint)x * 0x8DA6B343u ^ (uint)y * 0xD8163841u ^ salt * 0xCB1AB31Fu;
        h ^= h >> 13;
        h *= 0x5BD1E995u;
        h ^= h >> 15;
        return h;
    }
}
