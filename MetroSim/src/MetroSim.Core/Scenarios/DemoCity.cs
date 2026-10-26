using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Scenarios;

/// <summary>Where the demo city was laid out.</summary>
public sealed record DemoCityPlan(int OriginX, int OriginY, int Blocks)
{
    public const int BlockPitch = 6;

    public int Span => Blocks * BlockPitch;

    /// <summary>First interior tile of block (bx, by); interiors are 5x5.</summary>
    public (int X, int Y) BlockInterior(int bx, int by) => (OriginX + bx * BlockPitch + 1, OriginY + by * BlockPitch + 1);

    public bool IsReserved(int bx, int by) =>
        (bx == Blocks - 1 && by < 2) || (bx == Blocks / 2 - 1 && (by == 0 || by == Blocks - 1));
}

/// <summary>
/// Lays out a gridded city with commands (so it is logged and replayable): streets every six tiles,
/// avenues through the middle, residential west, commercial centre, industry east, and unzoned
/// reserve blocks for services. <see cref="AutoMayor"/> then keeps utilities ahead of demand.
/// </summary>
public static class DemoCity
{
    public static DemoCityPlan Build(Simulation sim, int blocks = 6)
    {
        var map = sim.Map;
        int span = blocks * DemoCityPlan.BlockPitch;
        if (span + 1 > map.Width || span + 1 > map.Height)
        {
            throw new ArgumentException("Map is too small for that many blocks.");
        }

        var (ox, oy) = FindFlatRegion(map, span + 1);
        var plan = new DemoCityPlan(ox, oy, blocks);
        int middle = blocks / 2;
        for (int k = 0; k <= blocks; k++)
        {
            int offset = k * DemoCityPlan.BlockPitch;
            var type = k == middle ? RoadType.Avenue : RoadType.Street;
            sim.Execute(new BuildRoadCommand(ox, oy + offset, ox + span, oy + offset, type));
            sim.Execute(new BuildRoadCommand(ox + offset, oy, ox + offset, oy + span, type));
        }

        int industrialFrom = blocks - Math.Max(1, blocks / 3);
        int commercialFrom = industrialFrom - Math.Max(1, blocks / 6);
        for (int by = 0; by < blocks; by++)
        {
            for (int bx = 0; bx < blocks; bx++)
            {
                if (plan.IsReserved(bx, by))
                {
                    continue;
                }

                var zone = bx >= industrialFrom ? ZoneType.Industrial
                    : bx >= commercialFrom ? ZoneType.Commercial
                    : ZoneType.Residential;
                var (ix, iy) = plan.BlockInterior(bx, by);
                sim.Execute(new ZoneCommand(ix, iy, ix + 4, iy + 4, zone));
            }
        }

        var (px, py) = plan.BlockInterior(blocks - 1, 0);
        sim.Execute(new PlaceBuildingCommand(BuildingKind.CoalPlant, px, py));
        var mayor = new AutoMayor(sim, plan);
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
/// it and can afford it. Everything goes through <see cref="Simulation.Execute"/>.
/// </summary>
public sealed class AutoMayor
{
    private readonly Simulation _sim;
    private readonly DemoCityPlan _plan;

    public AutoMayor(Simulation sim, DemoCityPlan plan)
    {
        _sim = sim;
        _plan = plan;
    }

    public int Actions { get; private set; }

    public void Manage()
    {
        var s = _sim.Stats;
        if (s.PowerDemand * 100 > PlannedCapacity(b => b.Spec.PowerOutput) * 85
            && !Place(BuildingKind.CoalPlant, preferEast: true))
        {
            // Can't afford coal yet: bridge the gap with cheap wind turbines.
            Place(BuildingKind.WindTurbine, preferEast: false);
        }

        if (s.WaterDemand * 100 > PlannedCapacity(b => b.Spec.WaterOutput) * 85)
        {
            EnsureWater();
        }

        if (s.Population > 150 && Count(BuildingKind.Landfill) == 0)
        {
            Place(BuildingKind.Landfill, preferEast: true);
        }
        else if (s.GarbageProducedPerDay * 100 > s.GarbageCapacityPerDay * 85 || s.LandfillUsedPercent > 70)
        {
            Place(s.LandfillUsedPercent > 50 ? BuildingKind.Incinerator : BuildingKind.Landfill, preferEast: true);
        }

        if (s.Population > 300 && Count(BuildingKind.FireStation) < 1 + s.Population / 4000)
        {
            Place(BuildingKind.FireStation, preferEast: false);
        }

        if (s.Population > 500 && Count(BuildingKind.Clinic) < 1 + s.Population / 5000)
        {
            Place(BuildingKind.Clinic, preferEast: false);
        }
    }

    /// <summary>Builds a water pump on the nearest shore (with a connecting road), else a water tower.</summary>
    public void EnsureWater()
    {
        if (TryPlacePump())
        {
            return;
        }

        Place(BuildingKind.WaterTower, preferEast: false);
    }

    /// <summary>Capacity of built and under-construction buildings, so the mayor does not double-buy.</summary>
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

    private bool Place(BuildingKind kind, bool preferEast)
    {
        var spec = BuildingCatalog.Get(kind);
        if (_sim.Budget.Money < spec.BuildCost + 200_000)
        {
            return false;
        }

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

    /// <summary>Reserve-block spots first, then any empty land near the city with road access.</summary>
    private IEnumerable<(int X, int Y)> CandidateSpots(int size, bool preferEast)
    {
        var map = _sim.Map;
        for (int by = 0; by < _plan.Blocks; by++)
        {
            for (int k = 0; k < _plan.Blocks; k++)
            {
                int bx = preferEast ? _plan.Blocks - 1 - k : k;
                if (!_plan.IsReserved(bx, by))
                {
                    continue;
                }

                var (ix, iy) = _plan.BlockInterior(bx, by);
                for (int dy = 0; dy + size <= 5; dy++)
                {
                    for (int dx = 0; dx + size <= 5; dx++)
                    {
                        if (IsFree(ix + dx, iy + dy, size) && GrowthSystem.FindAccess(map, ix + dx, iy + dy, size) >= 0)
                        {
                            yield return (ix + dx, iy + dy);
                        }
                    }
                }
            }
        }

        int margin = 4;
        for (int y = Math.Max(0, _plan.OriginY - margin); y < Math.Min(map.Height - size, _plan.OriginY + _plan.Span + margin); y++)
        {
            for (int x = Math.Max(0, _plan.OriginX - margin); x < Math.Min(map.Width - size, _plan.OriginX + _plan.Span + margin); x++)
            {
                if (IsFree(x, y, size) && GrowthSystem.FindAccess(map, x, y, size) >= 0)
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

    private bool TryPlacePump()
    {
        var map = _sim.Map;
        var spec = BuildingCatalog.Get(BuildingKind.WaterPump);
        if (_sim.Budget.Money < spec.BuildCost + 400_000)
        {
            return false;
        }

        int cx = _plan.OriginX + _plan.Span / 2;
        int cy = _plan.OriginY + _plan.Span / 2;
        int bestX = -1, bestY = -1, bestDistance = int.MaxValue;
        for (int y = 1; y < map.Height - 2; y++)
        {
            for (int x = 1; x < map.Width - 2; x++)
            {
                int distance = Math.Abs(x - cx) + Math.Abs(y - cy);
                if (distance >= bestDistance || distance > _plan.Span + 30 || !IsFree(x, y, 2) || !TouchesWater(x, y))
                {
                    continue;
                }

                if (!_sim.Estimate(new PlaceBuildingCommand(BuildingKind.WaterPump, x, y)).Success)
                {
                    continue;
                }

                bestDistance = distance;
                bestX = x;
                bestY = y;
            }
        }

        if (bestX < 0)
        {
            return false;
        }

        if (GrowthSystem.FindAccess(map, bestX, bestY, 2) < 0 && !ConnectByRoad(bestX, bestY))
        {
            return false;
        }

        if (!_sim.Execute(new PlaceBuildingCommand(BuildingKind.WaterPump, bestX, bestY)).Success)
        {
            return false;
        }

        Actions++;
        ConnectPower(bestX, bestY);
        return true;
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

    /// <summary>Power line from beside the pump to the edge of the city (pumps need electricity).</summary>
    private void ConnectPower(int x, int y)
    {
        var map = _sim.Map;
        int gx = Math.Clamp(x, _plan.OriginX + 1, _plan.OriginX + _plan.Span - 1);
        int gy = Math.Clamp(y, _plan.OriginY + 1, _plan.OriginY + _plan.Span - 1);
        int sx = x < gx ? x + 2 : x > gx ? x - 1 : x;
        int sy = y < gy ? y + 2 : y > gy ? y - 1 : y;
        if (map.InBounds(sx, sy) && (sx != gx || sy != gy)
            && _sim.Execute(new BuildPowerLineCommand(sx, sy, gx, gy)).Success)
        {
            Actions++;
        }
    }

    /// <summary>Road from beside the pump spot to the nearest point of the city grid.</summary>
    private bool ConnectByRoad(int x, int y)
    {
        var map = _sim.Map;
        // Start on a land tile directly beside the 2x2 footprint, facing the city.
        int cx = _plan.OriginX + _plan.Span / 2;
        int cy = _plan.OriginY + _plan.Span / 2;
        var starts = new (int X, int Y)[] { (x, y + 2), (x, y - 1), (x + 2, y), (x - 1, y) };
        foreach (var (sx, sy) in starts.OrderBy(s => Math.Abs(s.X - cx) + Math.Abs(s.Y - cy)))
        {
            if (!map.InBounds(sx, sy) || map.BuildingAt[map.Index(sx, sy)] != 0)
            {
                continue;
            }

            int gx = Math.Clamp(sx, _plan.OriginX, _plan.OriginX + _plan.Span);
            int gy = Math.Clamp(sy, _plan.OriginY, _plan.OriginY + _plan.Span);
            // Snap to the nearest grid line so the new road joins the network.
            gx = _plan.OriginX + (int)Math.Round((gx - _plan.OriginX) / (double)DemoCityPlan.BlockPitch, MidpointRounding.ToEven) * DemoCityPlan.BlockPitch;
            if (_sim.Execute(new BuildRoadCommand(sx, sy, gx, gy, RoadType.Street)).Success)
            {
                Actions++;
                return true;
            }
        }

        return false;
    }
}
