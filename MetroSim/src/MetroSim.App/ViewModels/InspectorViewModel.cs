using CommunityToolkit.Mvvm.ComponentModel;
using MetroSim.App.Game;
using MetroSim.App.Tools;
using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.World;

namespace MetroSim.App.ViewModels;

/// <summary>Details of the selected building, road tile, vehicle or terrain tile.</summary>
public sealed partial class InspectorViewModel : ObservableObject
{
    private string _capturedTitle = "Nothing selected";
    private string _capturedSubtitle = "Use the Select tool (Q) and click a building, road or vehicle.";
    private List<StatLine> _captured = [];

    [ObservableProperty]
    private string _title = "Nothing selected";

    [ObservableProperty]
    private string _subtitle = "";

    [ObservableProperty]
    private IReadOnlyList<StatLine> _lines = [];

    [ObservableProperty]
    private bool _hasSelection;

    /// <summary>Call with the state lock held.</summary>
    public void Capture(Simulation sim, MapSelection selection)
    {
        _captured = [];
        switch (selection.Kind)
        {
            case SelectionKind.Building when sim.Buildings[selection.Id] is { } b:
                CaptureBuilding(sim, b);
                break;
            case SelectionKind.Road when selection.Tile >= 0 && selection.Tile < sim.Map.TileCount && sim.Map.Roads[selection.Tile] != RoadType.None:
                CaptureRoad(sim, selection.Tile);
                break;
            case SelectionKind.Vehicle when sim.Traffic.Vehicles[selection.Id] is { } v:
                CaptureVehicle(sim, v);
                break;
            case SelectionKind.Tile when selection.Tile >= 0 && selection.Tile < sim.Map.TileCount:
                CaptureTile(sim, selection.Tile);
                break;
            case SelectionKind.None:
                _capturedTitle = "Nothing selected";
                _capturedSubtitle = "Use the Select tool (Q) and click a building, road or vehicle.";
                break;
            default:
                _capturedTitle = "Gone";
                _capturedSubtitle = selection.Kind == SelectionKind.Vehicle
                    ? "This trip has ended."
                    : "The selected object no longer exists.";
                break;
        }
    }

    public void Publish(MapSelection selection)
    {
        Title = _capturedTitle;
        Subtitle = _capturedSubtitle;
        Lines = _captured;
        HasSelection = selection.Kind != SelectionKind.None;
    }

    private void Add(string label, string value, bool warning = false) => _captured.Add(new StatLine(label, value, warning));

    private void CaptureBuilding(Simulation sim, Building b)
    {
        var spec = b.Spec;
        _capturedTitle = b.Kind.IsZoned() ? $"{spec.Name} building, level {b.Level}" : spec.Name;
        _capturedSubtitle = b.Abandoned ? "Abandoned"
            : !b.IsComplete ? $"Under construction ({b.ConstructionHours} h left)"
            : b.IsBurning ? $"On fire! Damage {b.FireDamage}%"
            : spec.Description.Length > 0 ? spec.Description : "Operating";

        Add("Position", $"({b.X}, {b.Y}), {b.Size}x{b.Size}");
        switch (b.Kind)
        {
            case BuildingKind.Residential:
                Add("Residents", $"{b.Residents} / {b.Capacity}");
                break;
            case BuildingKind.Commercial:
                Add("Workers", $"{b.Workers} / {b.Capacity}");
                Add("Customers yesterday", b.CustomersYesterday.ToString(System.Globalization.CultureInfo.InvariantCulture));
                break;
            case BuildingKind.Industrial:
                Add("Workers", $"{b.Workers} / {b.Capacity}");
                break;
            case BuildingKind.CoalPlant or BuildingKind.WindTurbine:
                Add("Power output", $"{sim.PowerOutputOf(b)} MW (rated {spec.PowerOutput})");
                break;
            case BuildingKind.WaterPump or BuildingKind.WaterTower:
                Add("Water output", Format.Number(spec.WaterOutput));
                break;
            case BuildingKind.Landfill:
                Add("Fill level", $"{Format.Number(b.Stored)} / {Format.Number(spec.StorageCapacity)} ({b.Stored * 100 / Math.Max(1, spec.StorageCapacity)}%)", b.Stored * 10 > spec.StorageCapacity * 8);
                Add("Capacity", $"{Format.Number(spec.DailyCapacity)} per day");
                break;
            case BuildingKind.Incinerator:
                Add("Capacity", $"{Format.Number(spec.DailyCapacity)} per day");
                break;
            case BuildingKind.FireStation:
                Add("Trucks out", $"{b.TrucksOut} / {spec.Vehicles}");
                break;
        }

        if (b.PowerUse > 0)
        {
            Add("Power", b.Powered ? $"connected ({b.PowerUse} MW)" : "NO POWER", !b.Powered && b.IsComplete);
        }

        if (b.WaterUse > 0)
        {
            Add("Water", b.Watered ? $"connected ({b.WaterUse})" : "NO WATER", !b.Watered && b.IsComplete);
        }

        if (b.Kind.IsZoned())
        {
            Add("Fire coverage", b.CoveredByFire ? "yes" : "no", !b.CoveredByFire);
            Add("Health coverage", b.CoveredByHealth ? "yes" : "no", !b.CoveredByHealth);
            Add("Garbage collection", b.CoveredByGarbage ? "yes" : "no", !b.CoveredByGarbage);
            Add("Garbage", Format.Number(b.Garbage), b.DaysGarbage > 0);
            int t = sim.Map.Index(b.X, b.Y);
            Add("Land value", sim.Map.LandValue[t].ToString(System.Globalization.CultureInfo.InvariantCulture));
            Add("Pollution", sim.Map.Pollution[t].ToString(System.Globalization.CultureInfo.InvariantCulture), sim.Map.Pollution[t] > 120);
        }

        Add("Road access", b.AccessTile >= 0 ? $"via ({sim.Map.X(b.AccessTile)}, {sim.Map.Y(b.AccessTile)})" : "NONE", b.AccessTile < 0);
        if (b.IsBurning)
        {
            Add("Fire damage", $"{b.FireDamage}%", true);
        }

        if (spec.UpkeepPerDay > 0)
        {
            Add("Upkeep", Format.Money(spec.UpkeepPerDay) + "/day");
        }
    }

    private void CaptureRoad(Simulation sim, int tile)
    {
        var map = sim.Map;
        var type = map.Roads[tile];
        _capturedTitle = type == RoadType.Avenue ? "Avenue" : "Street";
        _capturedSubtitle = map.Terrain[tile] == TerrainType.Water ? "Bridge" : sim.Roads.IsIntersection(tile) ? "Intersection" : "Road segment";
        Add("Position", $"({map.X(tile)}, {map.Y(tile)})");
        Add("Lane load (max)", $"{sim.Traffic.LaneLoadPercent(tile)}%", sim.Traffic.LaneLoadPercent(tile) >= 100);
        int capacity = RoadSpecs.LaneCapacity(type);
        foreach (var dir in new[] { Direction.North, Direction.East, Direction.South, Direction.West })
        {
            int occupancy = sim.Traffic.LaneOccupancy(tile, dir);
            Add($"{dir}bound lane", $"{occupancy} / {capacity} vehicles", occupancy >= capacity);
        }

        Add("Volume last hour", $"{sim.Traffic.VolumeLastHour[tile]} vehicles");
        Add("Free-flow speed", $"{RoadSpecs.FreeFlowSpeed(type) / 1000.0:0.0} tiles/min");
        Add("Upkeep", Format.Money(RoadSpecs.UpkeepPerTilePerDay(type)) + "/day");
    }

    private void CaptureVehicle(Simulation sim, Core.Traffic.Vehicle v)
    {
        _capturedTitle = v.Kind switch
        {
            Core.Traffic.VehicleKind.Pedestrian => "Pedestrian",
            Core.Traffic.VehicleKind.FireTruck => "Fire truck",
            _ => "Car",
        };
        _capturedSubtitle = v.Purpose switch
        {
            Core.Traffic.TripPurpose.ToWork => "Commuting to work",
            Core.Traffic.TripPurpose.ToHome => "Going home",
            Core.Traffic.TripPurpose.ToShop => "Going shopping",
            Core.Traffic.TripPurpose.FireCall => "Responding to a fire",
            _ => "Returning to the fire station",
        };

        if (v.CitizenId > 0 && sim.Citizens[v.CitizenId] is { } c)
        {
            Add("Owner", $"Citizen #{c.Id}, age {c.Age}");
            Add("Home", c.HomeId > 0 ? $"building #{c.HomeId}" : "none");
            Add("Job", c.JobId > 0 ? $"building #{c.JobId}" : "unemployed");
            Add("Satisfaction", $"{c.Satisfaction} / 100", c.Satisfaction < 40);
            Add("Last commute", $"{c.LastCommuteMinutes} min");
        }

        var map = sim.Map;
        Add("From", BuildingName(sim, v.OriginBuildingId));
        Add("To", BuildingName(sim, v.TargetBuildingId));
        Add("Position", $"({map.X(v.CurrentTile)}, {map.Y(v.CurrentTile)}) heading {v.Lane}");
        Add("Route", $"{v.PathIndex + 1} of {v.Path.Length} tiles ({v.Path.Length - 1 - v.PathIndex} to go)");
        Add("Trip time", $"{sim.Tick - v.StartTick} min (free flow {v.FreeFlowTicks} min)", sim.Tick - v.StartTick > v.FreeFlowTicks * 2);
        Add("Waiting", $"{v.WaitTicks} min", v.WaitTicks > 5);
        Add("Reroutes", v.Reroutes.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private static string BuildingName(Simulation sim, int id) =>
        sim.Buildings[id] is { } b ? $"{b.Spec.Name} #{id} at ({b.X}, {b.Y})" : id > 0 ? $"#{id} (gone)" : "-";

    private void CaptureTile(Simulation sim, int tile)
    {
        var map = sim.Map;
        _capturedTitle = map.Terrain[tile] switch
        {
            TerrainType.Water => "Water",
            TerrainType.Sand => "Beach",
            TerrainType.Rock => "Rock",
            _ => map.Trees[tile] > 0 ? "Woodland" : "Grassland",
        };
        _capturedSubtitle = map.Zones[tile] != ZoneType.None ? $"Zoned {map.Zones[tile]}" : map.IsBuildableLand(tile) ? "Buildable land" : "Not buildable";
        Add("Position", $"({map.X(tile)}, {map.Y(tile)})");
        Add("Elevation", $"{map.Elevation[tile]} (water level {sim.WaterLevel})");
        Add("Trees", map.Trees[tile].ToString(System.Globalization.CultureInfo.InvariantCulture));
        Add("Land value", map.LandValue[tile].ToString(System.Globalization.CultureInfo.InvariantCulture));
        Add("Pollution", map.Pollution[tile].ToString(System.Globalization.CultureInfo.InvariantCulture), map.Pollution[tile] > 120);
        Add("Power line", map.PowerLines[tile] ? "yes" : "no");
    }
}
