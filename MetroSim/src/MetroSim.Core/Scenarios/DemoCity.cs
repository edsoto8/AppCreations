using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Scenarios;

/// <summary>
/// Where the demo city may grow: a square of up to <see cref="Blocks"/> x <see cref="Blocks"/> blocks.
/// The layout repeats every six columns of blocks (R R C I R I), with a few unzoned reserve blocks for
/// services.
/// </summary>
public sealed record DemoCityPlan(int OriginX, int OriginY, int Blocks)
{
    public const int BlockPitch = 6;
    public const int PatternBlocks = 6;
    public const int CoreBlocks = 6;

    public int Span => Blocks * BlockPitch;

    /// <summary>First interior tile of block (bx, by); interiors are 5x5.</summary>
    public (int X, int Y) BlockInterior(int bx, int by) => (OriginX + bx * BlockPitch + 1, OriginY + by * BlockPitch + 1);

    public bool IsReserved(int bx, int by)
    {
        int px = bx % PatternBlocks;
        int py = by % PatternBlocks;
        return (px == 5 && py < 2) || (px == 2 && (py == 0 || py == 5));
    }

    public static ZoneType ZoneFor(int bx) => (bx % PatternBlocks) switch
    {
        2 => ZoneType.Commercial,
        3 or 5 => ZoneType.Industrial,
        _ => ZoneType.Residential,
    };

    /// <summary>Grid line k is an avenue every six lines (offset 3), otherwise a street.</summary>
    public static RoadType LineType(int k) => k % PatternBlocks == 3 ? RoadType.Avenue : RoadType.Street;
}

/// <summary>
/// Lays out a gridded starter city with commands (so it is logged and replayable). The
/// <see cref="AutoMayor"/> then keeps utilities ahead of demand and grows the grid outward.
/// </summary>
public static class DemoCity
{
    public static DemoCityPlan Build(Simulation sim, int blocks = 6)
    {
        var map = sim.Map;
        if (blocks < 3)
        {
            throw new ArgumentException("The demo city needs at least 3 blocks.");
        }

        int span = blocks * DemoCityPlan.BlockPitch;
        if (span + 1 > map.Width || span + 1 > map.Height)
        {
            throw new ArgumentException("Map is too small for that many blocks.");
        }

        var (ox, oy) = FindFlatRegion(map, span + 1);
        var plan = new DemoCityPlan(ox, oy, blocks);
        var mayor = new AutoMayor(sim, plan);
        mayor.BuildSquare(Math.Min(blocks, DemoCityPlan.CoreBlocks), from: 0);
        mayor.PlaceUtility(BuildingKind.CoalPlant);
        mayor.EnsureWater();
        return plan;
    }

    /// <summary>Steps the simulation, letting the mayor act every hour.</summary>
    public static void Run(Simulation sim, AutoMayor mayor, int ticks)
    {
        for (int i = 0; i < ticks; i++)
        {
            sim.Step();
            if (sim.Tick % Simulation.TicksPerHour == 0)
            {
                mayor.Manage();
            }
        }
    }

    /// <summary>Origin of the size x size window with the fewest water/rock tiles (closest to centre on ties).</summary>
    public static (int X, int Y) FindFlatRegion(CityMap map, int size)
    {
        int w = map.Width;
        int h = map.Height;
        var sat = new int[(w + 1) * (h + 1)];
        for (int y = 0; y < h; y++)
        {
            int row = 0;
            for (int x = 0; x < w; x++)
            {
                var t = map.Terrain[y * w + x];
                row += t is TerrainType.Water or TerrainType.Rock ? 1 : 0;
                sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
            }
        }

        int best = int.MaxValue;
        long bestCentre = long.MaxValue;
        (int, int) origin = (0, 0);
        for (int y = 0; y + size <= h; y++)
        {
            for (int x = 0; x + size <= w; x++)
            {
                int bad = sat[(y + size) * (w + 1) + x + size] - sat[y * (w + 1) + x + size]
                    - sat[(y + size) * (w + 1) + x] + sat[y * (w + 1) + x];
                long dx = x + size / 2 - w / 2;
                long dy = y + size / 2 - h / 2;
                long centre = dx * dx + dy * dy;
                if (bad < best || (bad == best && centre < bestCentre))
                {
                    best = bad;
                    bestCentre = centre;
                    origin = (x, y);
                }
            }
        }

        return origin;
    }
}

/// <summary>
/// A simple scripted player: adds power, water, garbage, fire and health capacity when the city needs
/// it and can afford it, and extends the street grid when zoned land runs out. Everything goes through
/// <see cref="Simulation.Execute"/>. It keeps no state of its own (the built extent is read from the
/// map), so a mayor can be attached to a loaded game.
/// </summary>
public sealed class AutoMayor
{
    private const long Reserve = 100_000;
    private readonly Simulation _sim;
    private readonly DemoCityPlan _plan;

    public AutoMayor(Simulation sim, DemoCityPlan plan)
    {
        _sim = sim;
        _plan = plan;
    }

    public int Actions { get; private set; }

    /// <summary>Blocks per side currently laid out (largest k whose bounding roads exist).</summary>
    public int BuiltBlocks
    {
        get
        {
            var map = _sim.Map;
            int k = 0;
            while (k < _plan.Blocks)
            {
                int x = _plan.OriginX + (k + 1) * DemoCityPlan.BlockPitch;
                int y = _plan.OriginY + (k + 1) * DemoCityPlan.BlockPitch;
                if (map.Roads[map.Index(x, _plan.OriginY)] == RoadType.None || map.Roads[map.Index(_plan.OriginX, y)] == RoadType.None)
                {
                    break;
                }

                k++;
            }

            return k;
        }
    }

    /// <summary>Buys at most one thing per call: the most stretched utility, then services, then growth.</summary>
    public void Manage()
    {
        var s = _sim.Stats;
        double power = Ratio(s.PowerDemand, PlannedCapacity(b => b.IsComplete ? b.PowerProduced : b.Spec.PowerOutput));
        double water = Ratio(s.WaterDemand, PlannedCapacity(b => b.IsComplete && !b.Powered ? 0 : b.Spec.WaterOutput));
        double garbage = s.Population > 150 && Count(BuildingKind.Landfill) + Count(BuildingKind.Incinerator) == 0
            ? double.MaxValue
            : Ratio(s.GarbageProducedPerDay, s.GarbageCapacityPerDay + PlannedCapacity(b => b.IsComplete ? 0 : b.Spec.DailyCapacity));
        double worst = Math.Max(power, Math.Max(water, garbage));
        if (worst > 0.85 && BuyUtility(worst == power ? 0 : worst == water ? 1 : 2))
        {
            return;
        }

        bool bought = (s.Population > 300 && Count(BuildingKind.FireStation) < 1 + s.Population / 3000 && PlaceUtility(BuildingKind.FireStation))
            || (s.Population > 500 && Count(BuildingKind.Clinic) < 1 + s.Population / 4000 && PlaceUtility(BuildingKind.Clinic));
        if (!bought)
        {
            // Also reached when a purchase failed for lack of space: a new ring of blocks makes room.
            TryExpand();
        }
    }

    private bool BuyUtility(int need)
    {
        var s = _sim.Stats;
        switch (need)
        {
            case 0:
                // Coal when affordable; bridge an actual shortfall with cheap wind turbines.
                return PlaceUtility(BuildingKind.CoalPlant)
                    || (s.PowerDemand * 100 > s.PowerProduction * 95 && PlaceUtility(BuildingKind.WindTurbine));
            case 1:
                return EnsureWater();
            default:
                bool full = s.LandfillUsedPercent > 50 || Count(BuildingKind.Landfill) >= 2;
                return PlaceUtility(full ? BuildingKind.Incinerator : BuildingKind.Landfill);
        }
    }

    /// <summary>Builds a water pump on the nearest shore (with road and power), else a water tower.</summary>
    public bool EnsureWater() => TryPlacePump() || PlaceUtility(BuildingKind.WaterTower);

    /// <summary>Places a service building in a reserve block, else any free spot inside the city.</summary>
    public bool PlaceUtility(BuildingKind kind)
    {
        var spec = BuildingCatalog.Get(kind);
        if (_sim.Budget.Money < spec.BuildCost + Reserve)
        {
            return false;
        }

        bool preferEast = kind is BuildingKind.CoalPlant or BuildingKind.Landfill or BuildingKind.Incinerator;
        foreach (var (x, y) in CandidateSpots(spec.Size, preferEast))
        {
            if (_sim.Execute(new PlaceBuildingCommand(kind, x, y)).Success)
            {
                Actions++;
                return true;
            }
        }

        return false;
    }

    /// <summary>Lays roads and zones for the blocks of a k x k square outside the existing from x from square.</summary>
    internal void BuildSquare(int k, int from)
    {
        int pitch = DemoCityPlan.BlockPitch;
        int ox = _plan.OriginX;
        int oy = _plan.OriginY;
        for (int line = 0; line <= k; line++)
        {
            var type = DemoCityPlan.LineType(line);
            int start = line <= from ? from * pitch : 0;
            Execute(new BuildRoadCommand(ox + start, oy + line * pitch, ox + k * pitch, oy + line * pitch, type));
            Execute(new BuildRoadCommand(ox + line * pitch, oy + start, ox + line * pitch, oy + k * pitch, type));
        }

        for (int by = 0; by < k; by++)
        {
            for (int bx = 0; bx < k; bx++)
            {
                if ((bx < from && by < from) || _plan.IsReserved(bx, by))
                {
                    continue;
                }

                var (ix, iy) = _plan.BlockInterior(bx, by);
                Execute(new ZoneCommand(ix, iy, ix + 4, iy + 4, DemoCityPlan.ZoneFor(bx)));
            }
        }
    }

    /// <summary>Adds a ring of blocks once almost all zoned land has been built on.</summary>
    private void TryExpand()
    {
        int built = BuiltBlocks;
        if (built >= _plan.Blocks || !ZonedLandNearlyFull())
        {
            return;
        }

        long cost = 0;
        int pitch = DemoCityPlan.BlockPitch;
        for (int line = 0; line <= built + 1; line++)
        {
            int start = line <= built ? built * pitch : 0;
            var type = DemoCityPlan.LineType(line);
            cost += _sim.Estimate(new BuildRoadCommand(_plan.OriginX + start, _plan.OriginY + line * pitch,
                _plan.OriginX + (built + 1) * pitch, _plan.OriginY + line * pitch, type)).Cost;
            cost += _sim.Estimate(new BuildRoadCommand(_plan.OriginX + line * pitch, _plan.OriginY + start,
                _plan.OriginX + line * pitch, _plan.OriginY + (built + 1) * pitch, type)).Cost;
        }

        if (_sim.Budget.Money >= cost + Reserve * 3)
        {
            BuildSquare(built + 1, built);
        }
    }

    private bool ZonedLandNearlyFull()
    {
        var map = _sim.Map;
        int zoned = 0;
        int open = 0;
        for (int t = 0; t < map.TileCount; t++)
        {
            if (map.Zones[t] == ZoneType.None)
            {
                continue;
            }

            zoned++;
            if (map.BuildingAt[t] == 0 && map.IsBuildableLand(t) && _sim.FindAccess(t % map.Width, t / map.Width, 1) >= 0)
            {
                open++;
            }
        }

        return zoned > 0 && open * 100 < zoned * 4;
    }

    private void Execute(GameCommand command)
    {
        if (_sim.Execute(command).Success)
        {
            Actions++;
        }
    }

    private static double Ratio(int used, int capacity) => capacity <= 0 ? (used > 0 ? double.MaxValue : 0) : used / (double)capacity;

    /// <summary>Operating capacity plus capacity under construction, so the mayor neither double-buys nor trusts dead plants.</summary>
    private int PlannedCapacity(Func<Building, int> output)
    {
        int total = 0;
        foreach (var b in _sim.Buildings)
        {
            total += b.Abandoned ? 0 : output(b);
        }

        return total;
    }

    private int Count(BuildingKind kind)
    {
        int n = 0;
        foreach (var b in _sim.Buildings)
        {
            n += b.Kind == kind ? 1 : 0;
        }

        return n;
    }

    /// <summary>Reserve-block spots first, then any empty land with road access inside the built city.</summary>
    private IEnumerable<(int X, int Y)> CandidateSpots(int size, bool preferEast)
    {
        var map = _sim.Map;
        int built = Math.Max(1, BuiltBlocks);
        for (int by = 0; by < built; by++)
        {
            for (int k = 0; k < built; k++)
            {
                int bx = preferEast ? built - 1 - k : k;
                if (!_plan.IsReserved(bx, by))
                {
                    continue;
                }

                var (ix, iy) = _plan.BlockInterior(bx, by);
                for (int dy = 0; dy + size <= 5; dy++)
                {
                    for (int dx = 0; dx + size <= 5; dx++)
                    {
                        if (IsFree(ix + dx, iy + dy, size) && _sim.FindAccess(ix + dx, iy + dy, size) >= 0)
                        {
                            yield return (ix + dx, iy + dy);
                        }
                    }
                }
            }
        }

        int extent = built * DemoCityPlan.BlockPitch;
        for (int y = _plan.OriginY; y < Math.Min(map.Height - size, _plan.OriginY + extent); y++)
        {
            for (int x = _plan.OriginX; x < Math.Min(map.Width - size, _plan.OriginX + extent); x++)
            {
                if (IsFree(x, y, size) && _sim.FindAccess(x, y, size) >= 0)
                {
                    yield return (x, y);
                }
            }
        }
    }

    private bool IsFree(int x, int y, int size)
    {
        var map = _sim.Map;
        for (int ty = y; ty < y + size; ty++)
        {
            for (int tx = x; tx < x + size; tx++)
            {
                if (!map.InBounds(tx, ty))
                {
                    return false;
                }

                int t = map.Index(tx, ty);
                if (!map.IsBuildableLand(t) || map.BuildingAt[t] != 0)
                {
                    return false;
                }
            }
        }

        return true;
    }

    /// <summary>
    /// A pump only where it will work at once: next to water, with road access joined to the city's
    /// network and within conduction range of the powered grid (checked read-only, without commands).
    /// </summary>
    private bool TryPlacePump()
    {
        var map = _sim.Map;
        var spec = BuildingCatalog.Get(BuildingKind.WaterPump);
        if (_sim.Budget.Money < spec.BuildCost + Reserve)
        {
            return false;
        }

        int cityRoad = map.Index(_plan.OriginX, _plan.OriginY);
        if (map.Roads[cityRoad] == RoadType.None)
        {
            return false;
        }

        var powered = PoweredReach();
        int extent = Math.Max(1, BuiltBlocks) * DemoCityPlan.BlockPitch;
        int cx = _plan.OriginX + extent / 2;
        int cy = _plan.OriginY + extent / 2;
        int bestX = -1, bestY = -1, bestDistance = int.MaxValue;
        for (int y = 0; y < map.Height - 1; y++)
        {
            for (int x = 0; x < map.Width - 1; x++)
            {
                int distance = Math.Abs(x - cx) + Math.Abs(y - cy);
                if (distance >= bestDistance || !IsFree(x, y, 2) || !TouchesWater(x, y) || OnFutureGridLine(x, y, 2)
                    || !NearPowered(powered, x, y, 2))
                {
                    continue;
                }

                int access = _sim.FindAccess(x, y, 2);
                if (access < 0 || !_sim.Roads.Connected(access, cityRoad)
                    || !_sim.Estimate(new PlaceBuildingCommand(BuildingKind.WaterPump, x, y)).Success)
                {
                    continue;
                }

                bestDistance = distance;
                bestX = x;
                bestY = y;
            }
        }

        if (bestX < 0 || !_sim.Execute(new PlaceBuildingCommand(BuildingKind.WaterPump, bestX, bestY)).Success)
        {
            return false;
        }

        Actions++;
        return true;
    }

    /// <summary>Tiles of the conductor network connected to a power plant (mirrors the utility rules, read-only).</summary>
    private bool[] PoweredReach()
    {
        var map = _sim.Map;
        var reached = new bool[map.TileCount];
        var queue = new Queue<int>();
        foreach (var b in _sim.Buildings)
        {
            if (b.Spec.PowerOutput == 0)
            {
                continue;
            }

            for (int ty = b.Y; ty < b.Y + b.Size; ty++)
            {
                for (int tx = b.X; tx < b.X + b.Size; tx++)
                {
                    int t = map.Index(tx, ty);
                    if (!reached[t])
                    {
                        reached[t] = true;
                        queue.Enqueue(t);
                    }
                }
            }
        }

        while (queue.Count > 0)
        {
            int t = queue.Dequeue();
            int cx = t % map.Width;
            int cy = t / map.Width;
            for (int dy = -2; dy <= 2; dy++)
            {
                for (int dx = -2; dx <= 2; dx++)
                {
                    int x = cx + dx;
                    int y = cy + dy;
                    if (!map.InBounds(x, y))
                    {
                        continue;
                    }

                    int nb = map.Index(x, y);
                    if (!reached[nb] && (map.BuildingAt[nb] != 0 || map.PowerLines[nb] || map.Zones[nb] != ZoneType.None))
                    {
                        reached[nb] = true;
                        queue.Enqueue(nb);
                    }
                }
            }
        }

        return reached;
    }

    private bool NearPowered(bool[] powered, int x, int y, int size)
    {
        var map = _sim.Map;
        for (int ty = y - 2; ty < y + size + 2; ty++)
        {
            for (int tx = x - 2; tx < x + size + 2; tx++)
            {
                if (map.InBounds(tx, ty) && powered[map.Index(tx, ty)])
                {
                    return true;
                }
            }
        }

        return false;
    }

    private bool OnFutureGridLine(int x, int y, int size)
    {
        bool insideX = x + size > _plan.OriginX && x <= _plan.OriginX + _plan.Span;
        bool insideY = y + size > _plan.OriginY && y <= _plan.OriginY + _plan.Span;
        if (!insideX || !insideY)
        {
            return false;
        }

        for (int k = 0; k < size; k++)
        {
            if ((x + k - _plan.OriginX) % DemoCityPlan.BlockPitch == 0 || (y + k - _plan.OriginY) % DemoCityPlan.BlockPitch == 0)
            {
                return true;
            }
        }

        return false;
    }

    private bool TouchesWater(int x, int y)
    {
        var map = _sim.Map;
        for (int ty = y - 1; ty <= y + 2; ty++)
        {
            for (int tx = x - 1; tx <= x + 2; tx++)
            {
                if (map.InBounds(tx, ty) && map.Terrain[map.Index(tx, ty)] == TerrainType.Water)
                {
                    return true;
                }
            }
        }

        return false;
    }
}
