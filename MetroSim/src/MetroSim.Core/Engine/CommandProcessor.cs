using MetroSim.Core.Buildings;
using MetroSim.Core.Roads;
using MetroSim.Core.World;

namespace MetroSim.Core.Engine;

/// <summary>Validates, prices and applies <see cref="GameCommand"/>s. With dryRun nothing changes.</summary>
internal sealed class CommandProcessor
{
    private readonly Simulation _sim;

    public CommandProcessor(Simulation sim) => _sim = sim;

    public CommandResult Apply(GameCommand command, bool dryRun) => command switch
    {
        BuildRoadCommand c => BuildRoad(c, dryRun),
        BuildPowerLineCommand c => BuildPowerLine(c, dryRun),
        BulldozeCommand c => Bulldoze(c, dryRun),
        ZoneCommand c => Zone(c, dryRun),
        PlaceBuildingCommand c => PlaceBuilding(c, dryRun),
        SetTaxCommand c => SetTax(c, dryRun),
        _ => CommandResult.Fail("Unknown command."),
    };

    private CityMap Map => _sim.Map;

    private CommandResult BuildRoad(BuildRoadCommand c, bool dryRun)
    {
        if (c.Type == RoadType.None)
        {
            return CommandResult.Fail("Choose a road type.");
        }

        if (!Map.InBounds(c.X0, c.Y0) || !Map.InBounds(c.X1, c.Y1))
        {
            return CommandResult.Fail("The road leaves the map.");
        }

        var tiles = new List<int>();
        long cost = 0;
        foreach (var (x, y) in CommandPaths.LPath(c.X0, c.Y0, c.X1, c.Y1))
        {
            int t = Map.Index(x, y);
            if (Map.Roads[t] == c.Type)
            {
                continue;
            }

            if (Map.BuildingAt[t] != 0)
            {
                return CommandResult.Fail($"A building is in the way at ({x}, {y}).");
            }

            tiles.Add(t);
            cost += RoadSpecs.BuildCostPerTile(c.Type) * RoadSpecs.TerrainCostMultiplier(Map.Terrain[t]);
        }

        if (tiles.Count == 0)
        {
            return CommandResult.Fail("That road already exists.");
        }

        if (!_sim.Budget.CanAfford(cost))
        {
            return new CommandResult(false, "Not enough money.", cost, tiles.Count);
        }

        if (!dryRun)
        {
            foreach (int t in tiles)
            {
                Map.Roads[t] = c.Type;
                Map.Zones[t] = ZoneType.None;
                Map.Trees[t] = 0;
                Map.PowerLines[t] = false;
            }

            _sim.Budget.ChargeConstruction(cost);
            Map.TouchRoads();
            _sim.Growth.RefreshAccess();
        }

        return new CommandResult(true, $"Built {tiles.Count} road tiles.", cost, tiles.Count);
    }

    private CommandResult BuildPowerLine(BuildPowerLineCommand c, bool dryRun)
    {
        if (!Map.InBounds(c.X0, c.Y0) || !Map.InBounds(c.X1, c.Y1))
        {
            return CommandResult.Fail("The power line leaves the map.");
        }

        var tiles = new List<int>();
        foreach (var (x, y) in CommandPaths.LPath(c.X0, c.Y0, c.X1, c.Y1))
        {
            int t = Map.Index(x, y);
            // Lines hop over roads and buildings: those tiles already conduct.
            if (Map.PowerLines[t] || Map.Roads[t] != RoadType.None || Map.BuildingAt[t] != 0)
            {
                continue;
            }

            tiles.Add(t);
        }

        if (tiles.Count == 0)
        {
            return CommandResult.Fail("Nothing to build here.");
        }

        long cost = tiles.Count * RoadSpecs.PowerLineCostPerTile;
        if (!_sim.Budget.CanAfford(cost))
        {
            return new CommandResult(false, "Not enough money.", cost, tiles.Count);
        }

        if (!dryRun)
        {
            foreach (int t in tiles)
            {
                Map.PowerLines[t] = true;
                Map.Zones[t] = ZoneType.None;
                Map.Trees[t] = 0;
            }

            _sim.Budget.ChargeConstruction(cost);
            Map.Touch();
        }

        return new CommandResult(true, $"Built {tiles.Count} power line tiles.", cost, tiles.Count);
    }

    private CommandResult Bulldoze(BulldozeCommand c, bool dryRun)
    {
        var (minX, minY, maxX, maxY) = CommandPaths.Rect(c.X0, c.Y0, c.X1, c.Y1);
        minX = Math.Max(0, minX);
        minY = Math.Max(0, minY);
        maxX = Math.Min(Map.Width - 1, maxX);
        maxY = Math.Min(Map.Height - 1, maxY);
        var roads = new List<int>();
        var lines = new List<int>();
        var buildings = new SortedSet<int>();
        for (int y = minY; y <= maxY; y++)
        {
            for (int x = minX; x <= maxX; x++)
            {
                int t = Map.Index(x, y);
                if (Map.Roads[t] != RoadType.None)
                {
                    roads.Add(t);
                }

                if (Map.PowerLines[t])
                {
                    lines.Add(t);
                }

                if (Map.BuildingAt[t] != 0)
                {
                    buildings.Add(Map.BuildingAt[t]);
                }
            }
        }

        int affected = roads.Count + lines.Count + buildings.Count;
        if (affected == 0)
        {
            return CommandResult.Fail("Nothing to bulldoze.");
        }

        long cost = roads.Count * RoadSpecs.BulldozeRoadCostPerTile;
        if (!_sim.Budget.CanAfford(cost))
        {
            return new CommandResult(false, "Not enough money.", cost, affected);
        }

        if (!dryRun)
        {
            foreach (int id in buildings)
            {
                _sim.Growth.RemoveBuilding(_sim.Buildings[id]!);
            }

            foreach (int t in lines)
            {
                Map.PowerLines[t] = false;
            }

            foreach (int t in roads)
            {
                Map.Roads[t] = RoadType.None;
            }

            _sim.Budget.ChargeConstruction(cost);
            Map.Touch();
            if (roads.Count > 0)
            {
                Map.TouchRoads();
                _sim.Growth.RefreshAccess();
                _sim.NotifyRoadsChanged();
            }
        }

        return new CommandResult(true, $"Bulldozed {affected} objects.", cost, affected);
    }

    private CommandResult Zone(ZoneCommand c, bool dryRun)
    {
        var (minX, minY, maxX, maxY) = CommandPaths.Rect(c.X0, c.Y0, c.X1, c.Y1);
        minX = Math.Max(0, minX);
        minY = Math.Max(0, minY);
        maxX = Math.Min(Map.Width - 1, maxX);
        maxY = Math.Min(Map.Height - 1, maxY);
        var tiles = new List<int>();
        var demolish = new SortedSet<int>();
        for (int y = minY; y <= maxY; y++)
        {
            for (int x = minX; x <= maxX; x++)
            {
                int t = Map.Index(x, y);
                if (!Map.IsBuildableLand(t) || Map.Zones[t] == c.Zone)
                {
                    continue;
                }

                int id = Map.BuildingAt[t];
                if (id != 0)
                {
                    var b = _sim.Buildings[id]!;
                    if (!b.Kind.IsZoned())
                    {
                        continue;
                    }

                    if (c.Zone != ZoneType.None)
                    {
                        // Rezoning never replaces a building; dezone it first.
                        continue;
                    }

                    demolish.Add(id);
                }

                tiles.Add(t);
            }
        }

        if (tiles.Count == 0)
        {
            return CommandResult.Fail(c.Zone == ZoneType.None ? "Nothing to dezone here." : "No zonable land here.");
        }

        if (!dryRun)
        {
            foreach (int id in demolish)
            {
                _sim.Growth.RemoveBuilding(_sim.Buildings[id]!);
            }

            foreach (int t in tiles)
            {
                Map.Zones[t] = c.Zone;
            }

            Map.Touch();
        }

        string verb = c.Zone == ZoneType.None ? "Dezoned" : $"Zoned {c.Zone.ToString().ToLowerInvariant()}:";
        return new CommandResult(true, $"{verb} {tiles.Count} tiles.", 0, tiles.Count);
    }

    private CommandResult PlaceBuilding(PlaceBuildingCommand c, bool dryRun)
    {
        if (c.Kind.IsZoned())
        {
            return CommandResult.Fail("Zoned buildings grow by themselves; paint a zone instead.");
        }

        var spec = BuildingCatalog.Get(c.Kind);
        if (!Map.InBounds(c.X, c.Y) || !Map.InBounds(c.X + spec.Size - 1, c.Y + spec.Size - 1))
        {
            return CommandResult.Fail("The building does not fit on the map.");
        }

        var replaced = new SortedSet<int>();
        bool touchesWater = false;
        for (int y = c.Y - 1; y <= c.Y + spec.Size; y++)
        {
            for (int x = c.X - 1; x <= c.X + spec.Size; x++)
            {
                if (!Map.InBounds(x, y))
                {
                    continue;
                }

                int t = Map.Index(x, y);
                bool inside = x >= c.X && y >= c.Y && x < c.X + spec.Size && y < c.Y + spec.Size;
                if (!inside)
                {
                    touchesWater |= Map.Terrain[t] == TerrainType.Water;
                    continue;
                }

                if (!Map.IsBuildableLand(t))
                {
                    return CommandResult.Fail("Needs clear, flat land (no water, rock, roads or power lines).");
                }

                int id = Map.BuildingAt[t];
                if (id != 0)
                {
                    if (!_sim.Buildings[id]!.Kind.IsZoned())
                    {
                        return CommandResult.Fail("Another building is in the way.");
                    }

                    replaced.Add(id);
                }
            }
        }

        if (c.Kind == BuildingKind.WaterPump && !touchesWater)
        {
            return CommandResult.Fail("A water pump must be built next to water.");
        }

        long cost = spec.BuildCost;
        if (!_sim.Budget.CanAfford(cost))
        {
            return new CommandResult(false, "Not enough money.", cost, spec.Size * spec.Size);
        }

        if (!dryRun)
        {
            foreach (int id in replaced)
            {
                _sim.Growth.RemoveBuilding(_sim.Buildings[id]!);
            }

            _sim.Growth.CreateBuilding(c.Kind, c.X, c.Y);
            _sim.Budget.ChargeConstruction(cost);
        }

        string access = GrowthSystem.FindAccess(Map, c.X, c.Y, spec.Size) >= 0 ? "" : " Warning: no road access.";
        return new CommandResult(true, $"Placed {spec.Name}.{access}", cost, spec.Size * spec.Size);
    }

    private CommandResult SetTax(SetTaxCommand c, bool dryRun)
    {
        if (c.Zone == ZoneType.None)
        {
            return CommandResult.Fail("Choose a zone.");
        }

        if (c.Percent is < Economy.Budget.MinTax or > Economy.Budget.MaxTax)
        {
            return CommandResult.Fail($"Tax must be between {Economy.Budget.MinTax}% and {Economy.Budget.MaxTax}%.");
        }

        if (!dryRun)
        {
            _sim.Budget.SetTax(c.Zone, c.Percent);
        }

        return new CommandResult(true, $"{c.Zone} tax set to {c.Percent}%.", 0, 0);
    }
}
