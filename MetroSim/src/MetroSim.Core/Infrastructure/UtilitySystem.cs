using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Infrastructure;

/// <summary>
/// Electricity and water allocation, every <see cref="Simulation.UtilityInterval"/> ticks.
/// Power travels between buildings, zoned land and power lines up to <see cref="ConductionRange"/> tiles
/// apart (so it crosses roads);
/// water travels through pipes assumed to run under every road.
/// </summary>
internal sealed class UtilitySystem
{
    public const int ConductionRange = 2;

    private readonly Simulation _sim;
    private readonly int[] _tileStamp;
    private readonly int[] _queue;
    private readonly List<int> _order = [];
    private readonly List<int> _sources = [];
    private int[] _buildingStamp = new int[64];
    private int[] _componentStamp = new int[64];
    private int _generation;

    public UtilitySystem(Simulation sim)
    {
        _sim = sim;
        _tileStamp = new int[sim.Map.TileCount];
        _queue = new int[sim.Map.TileCount];
    }

    public static int WindOutput(int elevation) => 80 + elevation * 3 / 5;

    public void Recompute()
    {
        RecomputePower();
        RecomputeWater();
    }

    public int PowerOutputOf(Building b)
    {
        if (!b.IsOperating || b.Spec.PowerOutput == 0)
        {
            return 0;
        }

        return b.Kind == BuildingKind.WindTurbine
            ? WindOutput(_sim.Map.Elevation[_sim.Map.Index(b.X, b.Y)])
            : b.Spec.PowerOutput;
    }

    private void RecomputePower()
    {
        var map = _sim.Map;
        var buildings = _sim.Buildings;
        if (_buildingStamp.Length < buildings.HighWater)
        {
            _buildingStamp = new int[Math.Max(buildings.HighWater, _buildingStamp.Length * 2)];
        }

        int gen = NextGeneration();
        foreach (var b in buildings)
        {
            b.Powered = false;
            b.PowerProduced = 0;
        }

        int production = 0, demand = 0, supplied = 0, unpowered = 0;
        foreach (var plant in buildings)
        {
            if (plant.Spec.PowerOutput == 0 || _buildingStamp[plant.Id] == gen)
            {
                continue;
            }

            // Breadth-first over conductors from this plant; consumers are served in discovery order.
            _order.Clear();
            int head = 0, tail = 0;
            _buildingStamp[plant.Id] = gen;
            _order.Add(plant.Id);
            for (int ty = plant.Y; ty < plant.Y + plant.Size; ty++)
            {
                for (int tx = plant.X; tx < plant.X + plant.Size; tx++)
                {
                    int t = map.Index(tx, ty);
                    _tileStamp[t] = gen;
                    _queue[tail++] = t;
                }
            }

            while (head < tail)
            {
                int t = _queue[head++];
                int cx = t % map.Width;
                int cy = t / map.Width;
                for (int dy = -ConductionRange; dy <= ConductionRange; dy++)
                {
                    for (int dx = -ConductionRange; dx <= ConductionRange; dx++)
                    {
                        int x = cx + dx;
                        int y = cy + dy;
                        if (!map.InBounds(x, y))
                        {
                            continue;
                        }

                        int nb = y * map.Width + x;
                        if (_tileStamp[nb] == gen)
                        {
                            continue;
                        }

                        int id = map.BuildingAt[nb];
                        if (id == 0 && !map.PowerLines[nb] && map.Zones[nb] == ZoneType.None)
                        {
                            continue;
                        }

                        _tileStamp[nb] = gen;
                        _queue[tail++] = nb;
                        if (id != 0 && _buildingStamp[id] != gen)
                        {
                            _buildingStamp[id] = gen;
                            _order.Add(id);
                        }
                    }
                }
            }

            int gridProduction = 0;
            foreach (int id in _order)
            {
                var b = buildings[id]!;
                b.PowerProduced = PowerOutputOf(b);
                gridProduction += b.PowerProduced;
            }

            production += gridProduction;
            int remaining = gridProduction;
            // Services (pumps, incinerators, stations) are served first so a brownout does not also
            // cut the water supply; then zoned buildings in breadth-first order from the plants.
            for (int pass = 0; pass < 2; pass++)
            {
                foreach (int id in _order)
                {
                    var b = buildings[id]!;
                    if (b.Kind.IsZoned() == (pass == 0))
                    {
                        continue;
                    }

                    int use = b.Abandoned ? 0 : b.PowerUse;
                    demand += use;
                    if (use <= remaining)
                    {
                        b.Powered = true;
                        remaining -= use;
                        supplied += use;
                    }
                }
            }
        }

        foreach (var b in buildings)
        {
            if (_buildingStamp[b.Id] != gen && !b.Abandoned)
            {
                demand += b.PowerUse;
            }

            if (!b.Powered && b.Kind.IsZoned() && b.IsOperating)
            {
                unpowered++;
            }
        }

        var s = _sim.Stats;
        s.PowerProduction = production;
        s.PowerDemand = demand;
        s.PowerSupplied = supplied;
        s.UnpoweredBuildings = unpowered;
    }

    private void RecomputeWater()
    {
        var buildings = _sim.Buildings;
        var roads = _sim.Roads;
        _sim.Index.Rebuild();
        if (_componentStamp.Length < roads.ComponentCount + 1)
        {
            _componentStamp = new int[Math.Max(roads.ComponentCount + 1, _componentStamp.Length * 2)];
        }

        int gen = NextGeneration();
        int capacity = 0, demand = 0, supplied = 0, unwatered = 0;
        foreach (var b in buildings)
        {
            b.Watered = false;
            if (!b.Abandoned)
            {
                demand += b.WaterUse;
            }
        }

        foreach (var source in buildings)
        {
            if (!IsActiveWaterSource(source))
            {
                continue;
            }

            int component = roads.ComponentOf(source.AccessTile);
            if (_componentStamp[component] == gen)
            {
                continue;
            }

            _componentStamp[component] = gen;
            _sources.Clear();
            int remaining = 0;
            foreach (var other in buildings)
            {
                if (IsActiveWaterSource(other) && roads.ComponentOf(other.AccessTile) == component)
                {
                    _sources.Add(other.AccessTile);
                    remaining += other.Spec.WaterOutput;
                }
            }

            capacity += remaining;
            _sim.Search.Run(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(_sources), int.MaxValue);
            for (int k = 0; k < _sim.Search.VisitedCount; k++)
            {
                int tile = _sim.Search.Visited(k);
                for (int id = _sim.Index.First(tile); id != 0; id = _sim.Index.Next(id))
                {
                    var b = buildings[id]!;
                    int use = b.Abandoned ? 0 : b.WaterUse;
                    if (use <= remaining)
                    {
                        b.Watered = true;
                        remaining -= use;
                        supplied += use;
                    }
                }
            }
        }

        foreach (var b in buildings)
        {
            if (!b.Watered && b.Kind.IsZoned() && b.IsOperating)
            {
                unwatered++;
            }
        }

        var s = _sim.Stats;
        s.WaterCapacity = capacity;
        s.WaterDemand = demand;
        s.WaterSupplied = supplied;
        s.UnwateredBuildings = unwatered;
    }

    private static bool IsActiveWaterSource(Building b) =>
        b.Spec.WaterOutput > 0 && b.IsOperating && b.Powered && b.AccessTile >= 0;

    private int NextGeneration()
    {
        _generation++;
        if (_generation == int.MaxValue)
        {
            Array.Clear(_tileStamp);
            Array.Clear(_buildingStamp);
            Array.Clear(_componentStamp);
            _generation = 1;
        }

        return _generation;
    }
}
