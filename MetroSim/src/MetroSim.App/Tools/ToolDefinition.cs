using Avalonia.Input;
using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Roads;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Tools;

public enum ToolKind
{
    Select,
    Street,
    Avenue,
    PowerLine,
    Bulldoze,
    ZoneResidential,
    ZoneCommercial,
    ZoneIndustrial,
    Dezone,
    CoalPlant,
    WindTurbine,
    WaterPump,
    WaterTower,
    Landfill,
    Incinerator,
    FireStation,
    Clinic,
}

/// <summary>How the pointer drives a tool.</summary>
public enum ToolInteraction
{
    /// <summary>Click selects what is under the cursor.</summary>
    Select,

    /// <summary>Drag an L-shaped path (horizontal first, then vertical).</summary>
    Path,

    /// <summary>Drag a rectangle.</summary>
    Rectangle,

    /// <summary>A ghost footprint follows the cursor; click places.</summary>
    Place,
}

/// <summary>A tool: what it is called, its shortcut, and which command it issues for a drag or click.</summary>
public sealed record ToolDefinition(
    ToolKind Kind,
    string Name,
    string Group,
    ToolInteraction Interaction,
    Key Shortcut,
    string ShortcutLabel,
    string Description)
{
    public RoadType Road { get; init; }

    /// <summary>A second key for the same tool.</summary>
    public Key AltShortcut { get; init; }

    public ZoneType Zone { get; init; }

    public BuildingKind? Building { get; init; }

    public int Footprint => Building is { } kind ? BuildingCatalog.Get(kind).Size : 1;

    /// <summary>Ghost colour of a valid preview.</summary>
    public SKColor PreviewColour => Kind switch
    {
        ToolKind.Bulldoze or ToolKind.Dezone => new SKColor(0xFF, 0x80, 0x40),
        ToolKind.ZoneResidential or ToolKind.ZoneCommercial or ToolKind.ZoneIndustrial => Palette.ZoneColour(Zone),
        _ => new SKColor(0x50, 0xE0, 0x70),
    };

    /// <summary>
    /// The command for a drag from (x0, y0) to (x1, y1); for placement tools (x1, y1) is the cursor
    /// tile and the footprint is centred on it.
    /// </summary>
    public GameCommand? CommandFor(int x0, int y0, int x1, int y1) => Interaction switch
    {
        ToolInteraction.Path when Kind == ToolKind.PowerLine => new BuildPowerLineCommand(x0, y0, x1, y1),
        ToolInteraction.Path => new BuildRoadCommand(x0, y0, x1, y1, Road),
        ToolInteraction.Rectangle when Kind == ToolKind.Bulldoze => new BulldozeCommand(x0, y0, x1, y1),
        ToolInteraction.Rectangle => new ZoneCommand(x0, y0, x1, y1, Zone),
        ToolInteraction.Place when Building is { } kind => new PlaceBuildingCommand(kind, PlaceOrigin(x1), PlaceOrigin(y1)),
        _ => null,
    };

    /// <summary>Top-left tile of a footprint centred on the cursor tile.</summary>
    public int PlaceOrigin(int cursor) => cursor - (Footprint - 1) / 2;

    /// <summary>Tile rectangles the ghost covers.</summary>
    public IReadOnlyList<TileRect> PreviewRects(int x0, int y0, int x1, int y1)
    {
        switch (Interaction)
        {
            case ToolInteraction.Path:
                // Same L as CommandPaths.LPath: horizontal leg on y0, then vertical leg on x1.
                return y0 == y1 || x0 == x1
                    ? [TileRect.Of(x0, y0, x1, y1)]
                    : [TileRect.Of(x0, y0, x1, y0), TileRect.Of(x1, y0 + Math.Sign(y1 - y0), x1, y1)];
            case ToolInteraction.Rectangle:
                return [TileRect.Of(x0, y0, x1, y1)];
            case ToolInteraction.Place:
                int ox = PlaceOrigin(x1);
                int oy = PlaceOrigin(y1);
                return [new TileRect(ox, oy, ox + Footprint - 1, oy + Footprint - 1)];
            default:
                return [];
        }
    }

}

public static class ToolCatalog
{
    public static readonly IReadOnlyList<ToolDefinition> All = Create();

    public static ToolDefinition Get(ToolKind kind) => All[(int)kind];

    /// <summary>The tool bound to a key (no modifiers), or null.</summary>
    public static ToolDefinition? ForKey(Key key) =>
        key == Key.None ? null : All.FirstOrDefault(t => t.Shortcut == key || t.AltShortcut == key);

    private static List<ToolDefinition> Create()
    {
        string RoadInfo(RoadType type) => $"{Format.Money(RoadSpecs.BuildCostPerTile(type))}/tile (x4 bridge, x2 rock), upkeep {Format.Money(RoadSpecs.UpkeepPerTilePerDay(type) * 100)}/100 tiles/day";

        var tools = new List<ToolDefinition>
        {
            new(ToolKind.Select, "Select", "Inspect", ToolInteraction.Select, Key.Q, "Q / Esc", "Click a building, road or vehicle to inspect it."),
            new(ToolKind.Street, "Street", "Roads", ToolInteraction.Path, Key.D1, "1", "Two-lane street. " + RoadInfo(RoadType.Street)) { Road = RoadType.Street },
            new(ToolKind.Avenue, "Avenue", "Roads", ToolInteraction.Path, Key.D2, "2", "Four-lane avenue, faster and higher capacity. " + RoadInfo(RoadType.Avenue)) { Road = RoadType.Avenue },
            new(ToolKind.PowerLine, "Power line", "Roads", ToolInteraction.Path, Key.D3, "3", $"Carries power between grids. {Format.Money(RoadSpecs.PowerLineCostPerTile)}/tile."),
            new(ToolKind.Bulldoze, "Bulldoze", "Roads", ToolInteraction.Rectangle, Key.B, "B / 4", "Removes roads, power lines and buildings in a rectangle.") { AltShortcut = Key.D4 },
            new(ToolKind.ZoneResidential, "Residential", "Zones", ToolInteraction.Rectangle, Key.D5, "5", "Homes grow here when residential demand is positive. Free.") { Zone = ZoneType.Residential },
            new(ToolKind.ZoneCommercial, "Commercial", "Zones", ToolInteraction.Rectangle, Key.D6, "6", "Shops and offices. Free.") { Zone = ZoneType.Commercial },
            new(ToolKind.ZoneIndustrial, "Industrial", "Zones", ToolInteraction.Rectangle, Key.D7, "7", "Factories: many jobs, some pollution. Free.") { Zone = ZoneType.Industrial },
            new(ToolKind.Dezone, "Dezone", "Zones", ToolInteraction.Rectangle, Key.D8, "8", "Removes zoning (and zoned buildings).") { Zone = ZoneType.None },
        };

        (ToolKind Tool, BuildingKind Building, Key Key, string Label)[] services =
        [
            (ToolKind.CoalPlant, BuildingKind.CoalPlant, Key.C, "C"),
            (ToolKind.WindTurbine, BuildingKind.WindTurbine, Key.T, "T"),
            (ToolKind.WaterPump, BuildingKind.WaterPump, Key.P, "P"),
            (ToolKind.WaterTower, BuildingKind.WaterTower, Key.O, "O"),
            (ToolKind.Landfill, BuildingKind.Landfill, Key.L, "L"),
            (ToolKind.Incinerator, BuildingKind.Incinerator, Key.I, "I"),
            (ToolKind.FireStation, BuildingKind.FireStation, Key.F, "F"),
            (ToolKind.Clinic, BuildingKind.Clinic, Key.H, "H"),
        ];

        foreach (var (tool, building, key, label) in services)
        {
            var spec = BuildingCatalog.Get(building);
            string group = spec.Category switch
            {
                ServiceCategory.Power => "Power",
                ServiceCategory.Water => "Water",
                ServiceCategory.Garbage => "Garbage",
                _ => "Services",
            };
            tools.Add(new ToolDefinition(tool, spec.Name, group, ToolInteraction.Place, key, label,
                $"{spec.Description} {Format.Money(spec.BuildCost)}, upkeep {Format.Money(spec.UpkeepPerDay)}/day, {spec.Size}x{spec.Size}.")
            {
                Building = building,
            });
        }

        return tools;
    }
}

public enum SelectionKind
{
    None,
    Building,
    Road,
    Vehicle,
    Tile,
}

/// <summary>What the inspector shows. <see cref="Id"/> is a building or vehicle id; <see cref="Tile"/> a tile index.</summary>
public sealed record MapSelection(SelectionKind Kind, int Id, int Tile)
{
    public static readonly MapSelection None = new(SelectionKind.None, 0, -1);
}
