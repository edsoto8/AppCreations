using MetroSim.Core.Economy;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Buildings;

/// <summary>Zone development, construction, levelling up, abandonment and building removal.</summary>
internal sealed class GrowthSystem
{
    public const int AccessRange = 2;
    private const int AbandonAfterDaysUnpowered = 4;
    private const int AbandonAfterDaysNoWater = 4;
    private const int AbandonAfterDaysNoAccess = 3;
    private const int AbandonAfterDaysGarbage = 5;
    private const int AbandonAfterDaysNoWorkers = 7;
    private const int CollapseAfterDays = 5;
    private const int LevelUpAfterGoodDays = 3;

    private readonly Simulation _sim;
    private readonly List<int>[] _candidates = [[], [], [], []];
    private bool[] _flagged = new bool[64];

    public GrowthSystem(Simulation sim) => _sim = sim;

    /// <summary>
    /// Nearest road tile within <see cref="AccessRange"/> (Manhattan) of a footprint, scanning distance 1
    /// then 2 in row-major order. -1 when there is none.
    /// </summary>
    public static int FindAccess(CityMap map, int x, int y, int size)
    {
        for (int d = 1; d <= AccessRange; d++)
        {
            for (int ty = y - d; ty < y + size + d; ty++)
            {
                for (int tx = x - d; tx < x + size + d; tx++)
                {
                    if (!map.InBounds(tx, ty))
                    {
                        continue;
                    }

                    int dx = tx < x ? x - tx : tx >= x + size ? tx - (x + size - 1) : 0;
                    int dy = ty < y ? y - ty : ty >= y + size ? ty - (y + size - 1) : 0;
                    if (dx + dy == d && map.Roads[map.Index(tx, ty)] != RoadType.None)
                    {
                        return map.Index(tx, ty);
                    }
                }
            }
        }

        return -1;
    }

    public void RefreshAccess()
    {
        foreach (var b in _sim.Buildings)
        {
            b.AccessTile = FindAccess(_sim.Map, b.X, b.Y, b.Size);
        }

        _sim.TouchBuildings();
    }

    public Building CreateBuilding(BuildingKind kind, int x, int y)
    {
        var spec = BuildingCatalog.Get(kind);
        var map = _sim.Map;
        var b = new Building
        {
            Kind = kind,
            X = x,
            Y = y,
            Size = spec.Size,
            ConstructionHours = spec.ConstructionHours,
            AccessTile = FindAccess(map, x, y, spec.Size),
        };
        _sim.Buildings.Add(b);
        for (int ty = y; ty < y + spec.Size; ty++)
        {
            for (int tx = x; tx < x + spec.Size; tx++)
            {
                int t = map.Index(tx, ty);
                map.BuildingAt[t] = b.Id;
                map.Trees[t] = 0;
                if (!kind.IsZoned())
                {
                    map.Zones[t] = ZoneType.None;
                }
            }
        }

        map.Touch();
        _sim.TouchBuildings();
        return b;
    }

    /// <summary>Removes a building, evicting residents and workers. Zoning on its tiles stays.</summary>
    public void RemoveBuilding(Building b)
    {
        EnsureFlags();
        Array.Clear(_flagged);
        _flagged[b.Id] = true;
        _sim.CitizenSystem.Evict(id => id < _flagged.Length && _flagged[id]);
        ClearTiles(b);
        _sim.Buildings.Remove(b.Id);
        _sim.Map.Touch();
        _sim.TouchBuildings();
    }

    public void AdvanceConstruction()
    {
        bool changed = false;
        foreach (var b in _sim.Buildings)
        {
            if (b.ConstructionHours > 0)
            {
                b.ConstructionHours--;
                changed |= b.ConstructionHours == 0;
            }
        }

        if (changed)
        {
            _sim.Map.Touch();
            _sim.TouchBuildings();
        }
    }

    /// <summary>Spawns new level-1 buildings on zoned land with road access, in proportion to demand.</summary>
    public void SpawnBuildings()
    {
        var map = _sim.Map;
        foreach (var list in _candidates)
        {
            list.Clear();
        }

        for (int t = 0; t < map.TileCount; t++)
        {
            var zone = map.Zones[t];
            if (zone == ZoneType.None || map.BuildingAt[t] != 0 || !map.IsBuildableLand(t))
            {
                continue;
            }

            if (FindAccess(map, t % map.Width, t / map.Width, 1) >= 0)
            {
                _candidates[(int)zone].Add(t);
            }
        }

        SpawnZone(ZoneType.Residential, _sim.Demand.Residential);
        SpawnZone(ZoneType.Commercial, _sim.Demand.Commercial);
        SpawnZone(ZoneType.Industrial, _sim.Demand.Industrial);
    }

    /// <summary>Daily building conditions: levelling up, abandonment and collapse of abandoned buildings.</summary>
    public void DailyConditions()
    {
        var map = _sim.Map;
        EnsureFlags();
        Array.Clear(_flagged);
        bool anyAbandoned = false;
        var collapsed = new List<Building>();
        foreach (var b in _sim.Buildings)
        {
            if (!b.Kind.IsZoned() || !b.IsComplete)
            {
                continue;
            }

            if (b.Abandoned)
            {
                if (++b.AbandonedDays >= CollapseAfterDays)
                {
                    collapsed.Add(b);
                }

                continue;
            }

            b.DaysUnpowered = b.Powered ? 0 : b.DaysUnpowered + 1;
            b.DaysNoWater = b.Watered ? 0 : b.DaysNoWater + 1;
            b.DaysNoAccess = b.AccessTile >= 0 ? 0 : b.DaysNoAccess + 1;
            b.DaysNoWorkers = b.Kind == BuildingKind.Residential || b.Workers > 0 ? 0 : b.DaysNoWorkers + 1;

            string? reason = b.DaysNoAccess >= AbandonAfterDaysNoAccess ? "no road access"
                : b.DaysUnpowered >= AbandonAfterDaysUnpowered ? "no electricity"
                : b.DaysNoWater >= AbandonAfterDaysNoWater ? "no water"
                : b.DaysGarbage >= AbandonAfterDaysGarbage ? "uncollected garbage"
                : b.DaysNoWorkers >= AbandonAfterDaysNoWorkers ? "no workers"
                : null;
            if (reason is not null)
            {
                b.Abandoned = true;
                b.AbandonedDays = 0;
                b.GoodDays = 0;
                _flagged[b.Id] = true;
                anyAbandoned = true;
                _sim.AddEvent(EventSeverity.Warning, $"{b.Spec.Name} building abandoned: {reason}.", map.Index(b.X, b.Y));
                continue;
            }

            int occupancy = b.Kind == BuildingKind.Residential ? b.Residents : b.Workers;
            bool good = b.Powered && b.Watered && b.DaysGarbage == 0 && b.Level < ZoneLevels.MaxLevel
                && map.LandValue[map.Index(b.X, b.Y)] >= ZoneLevels.LandValueForLevel[b.Level]
                && occupancy * 4 >= b.Capacity * 3;
            b.GoodDays = good ? b.GoodDays + 1 : 0;
            if (b.GoodDays >= LevelUpAfterGoodDays)
            {
                b.Level++;
                b.GoodDays = 0;
                map.Touch();
            }
        }

        if (anyAbandoned)
        {
            _sim.CitizenSystem.Evict(id => id < _flagged.Length && _flagged[id]);
            foreach (var b in _sim.Buildings)
            {
                if (b.Abandoned)
                {
                    b.Residents = 0;
                    b.Workers = 0;
                }
            }

            map.Touch();
            _sim.TouchBuildings();
        }

        foreach (var b in collapsed)
        {
            RemoveBuilding(b);
        }
    }

    private void SpawnZone(ZoneType zone, int demand)
    {
        var list = _candidates[(int)zone];
        int count = EconomyModel.GrowthPerHour(demand);
        var rng = _sim.Rng.Growth;
        var map = _sim.Map;
        for (int k = 0; k < count && list.Count > 0; k++)
        {
            // Best land value (or least pollution for industry) of three random candidates.
            int bestIndex = -1;
            int bestScore = int.MinValue;
            for (int s = 0; s < 3; s++)
            {
                int index = rng.Next(list.Count);
                int t = list[index];
                int score = zone == ZoneType.Industrial ? -map.LandValue[t] : map.LandValue[t] - map.Pollution[t];
                if (score > bestScore)
                {
                    bestScore = score;
                    bestIndex = index;
                }
            }

            int tile = list[bestIndex];
            list[bestIndex] = list[^1];
            list.RemoveAt(list.Count - 1);
            CreateBuilding(BuildingKinds.ForZone(zone), tile % map.Width, tile / map.Width);
        }
    }

    private void ClearTiles(Building b)
    {
        var map = _sim.Map;
        for (int ty = b.Y; ty < b.Y + b.Size; ty++)
        {
            for (int tx = b.X; tx < b.X + b.Size; tx++)
            {
                int t = map.Index(tx, ty);
                if (map.BuildingAt[t] == b.Id)
                {
                    map.BuildingAt[t] = 0;
                }
            }
        }
    }

    private void EnsureFlags()
    {
        if (_flagged.Length < _sim.Buildings.HighWater)
        {
            _flagged = new bool[Math.Max(_sim.Buildings.HighWater, _flagged.Length * 2)];
        }
    }
}
