using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Traffic;

namespace MetroSim.Core.Infrastructure;

/// <summary>Service coverage (hourly), garbage collection (daily) and fires (hourly ignition, per-tick fighting).</summary>
internal sealed class ServiceSystem
{
    public const byte FireBit = 1;
    public const byte HealthBit = 2;
    public const byte GarbageBit = 4;

    /// <summary>Hourly ignition odds are 1 in this many, per building; doubled inside fire coverage.</summary>
    public const int ResidentialFireOdds = 24_000;
    public const int CommercialFireOdds = 19_200;
    public const int IndustrialFireOdds = 9_600;

    /// <summary>A badly burning building ignites each neighbour with odds 1 in this, every 30 ticks.</summary>
    public const int SpreadOdds = 40;

    private readonly Simulation _sim;

    public ServiceSystem(Simulation sim)
    {
        _sim = sim;
        TileCoverage = new byte[sim.Map.TileCount];
    }

    /// <summary>Coverage bits per road tile from the last hourly recompute.</summary>
    public byte[] TileCoverage { get; }

    public void RecomputeCoverage()
    {
        Array.Clear(TileCoverage);
        var search = _sim.Search;
        foreach (var b in _sim.Buildings)
        {
            byte bit = b.Spec.Category switch
            {
                ServiceCategory.Fire => FireBit,
                ServiceCategory.Health => HealthBit,
                ServiceCategory.Garbage => GarbageBit,
                _ => 0,
            };
            if (bit == 0 || !b.IsOperating || b.AccessTile < 0)
            {
                continue;
            }

            search.Run(b.AccessTile, b.Spec.CoverageRange);
            for (int k = 0; k < search.VisitedCount; k++)
            {
                TileCoverage[search.Visited(k)] |= bit;
            }
        }

        foreach (var b in _sim.Buildings)
        {
            byte mask = b.AccessTile >= 0 ? TileCoverage[b.AccessTile] : (byte)0;
            b.CoveredByFire = (mask & FireBit) != 0;
            b.CoveredByHealth = (mask & HealthBit) != 0;
            b.CoveredByGarbage = (mask & GarbageBit) != 0;
        }
    }

    public static int DailyGarbage(Building b) => b.Kind switch
    {
        BuildingKind.Residential => b.Residents / 2 + 1,
        BuildingKind.Commercial => b.Workers / 2 + b.CustomersToday / 8,
        BuildingKind.Industrial => b.Workers,
        _ => 0,
    };

    /// <summary>Buildings produce garbage; facilities collect from the nearest buildings by road first.</summary>
    public void CollectGarbage()
    {
        var buildings = _sim.Buildings;
        int produced = 0;
        int capacityTotal = 0;
        foreach (var b in buildings)
        {
            if (b.IsOperating)
            {
                int amount = DailyGarbage(b);
                b.Garbage += amount;
                produced += amount;
            }
        }

        _sim.Index.Rebuild();
        var search = _sim.Search;
        foreach (var facility in buildings)
        {
            if (facility.Spec.Category != ServiceCategory.Garbage || !facility.IsOperating || facility.AccessTile < 0)
            {
                continue;
            }

            bool landfill = facility.Kind == BuildingKind.Landfill;
            if (!landfill && !facility.Powered)
            {
                continue;
            }

            int capacity = landfill
                ? Math.Min(facility.Spec.DailyCapacity, facility.Spec.StorageCapacity - facility.Stored)
                : facility.Spec.DailyCapacity;
            capacityTotal += Math.Max(0, capacity);
            if (capacity <= 0)
            {
                continue;
            }

            search.Run(facility.AccessTile, facility.Spec.CoverageRange);
            for (int k = 0; k < search.VisitedCount && capacity > 0; k++)
            {
                for (int id = _sim.Index.First(search.Visited(k)); id != 0 && capacity > 0; id = _sim.Index.Next(id))
                {
                    var b = buildings[id]!;
                    int take = Math.Min(b.Garbage, capacity);
                    b.Garbage -= take;
                    capacity -= take;
                    if (landfill)
                    {
                        facility.Stored += take;
                    }
                }
            }
        }

        _sim.Stats.GarbageProducedPerDay = produced;
        _sim.Stats.GarbageCapacityPerDay = capacityTotal;
        foreach (var b in buildings)
        {
            int threshold = Math.Max(20, DailyGarbage(b) * 3);
            b.DaysGarbage = b.Kind.IsZoned() && b.Garbage > threshold ? b.DaysGarbage + 1 : 0;
        }
    }

    public void IgniteFires()
    {
        var rng = _sim.Rng.Events;
        var map = _sim.Map;
        foreach (var b in _sim.Buildings)
        {
            if (!b.Kind.IsZoned() || !b.IsOperating || b.IsBurning)
            {
                continue;
            }

            int odds = b.Kind switch
            {
                BuildingKind.Residential => ResidentialFireOdds,
                BuildingKind.Commercial => CommercialFireOdds,
                _ => IndustrialFireOdds,
            };
            if (rng.Chance(1, b.CoveredByFire ? odds * 2 : odds))
            {
                Ignite(b);
                _sim.AddEvent(EventSeverity.Warning, $"Fire in {Article(b)} building!", map.Index(b.X, b.Y));
            }
        }
    }

    public void UpdateFires(long tick)
    {
        var buildings = _sim.Buildings;
        for (int id = 1; id < buildings.HighWater; id++)
        {
            var b = buildings[id];
            if (b is null || !b.IsBurning)
            {
                continue;
            }

            if (b.ExtinguishTicks > 0)
            {
                if (--b.ExtinguishTicks == 0)
                {
                    b.FireDamage = 0;
                    b.FireTruckId = 0;
                    _sim.Stats.FiresExtinguished++;
                    ReturnTruck(b.FireStationId, b.AccessTile, tick);
                    _sim.Map.Touch();
                }

                continue;
            }

            if (b.FireTruckId == 0 && b.CoveredByFire && tick % 15 == b.Id % 15)
            {
                DispatchTruck(b, tick);
            }

            if (tick % 2 == 0)
            {
                b.FireDamage++;
            }

            if (b.FireDamage >= 100)
            {
                _sim.Stats.BuildingsBurnedDown++;
                _sim.AddEvent(EventSeverity.Critical, $"{char.ToUpperInvariant(Article(b)[0])}{Article(b)[1..]} building burned down.", _sim.Map.Index(b.X, b.Y));
                _sim.Growth.RemoveBuilding(b);
                continue;
            }

            if (b.FireDamage > 60 && tick % 30 == 0)
            {
                SpreadFire(b);
            }
        }
    }

    public void OnTruckArrived(Vehicle v, long tick)
    {
        if (v.Purpose == TripPurpose.FireReturn)
        {
            ReleaseTruck(v.TargetBuildingId);
            return;
        }

        var b = _sim.Buildings[v.TargetBuildingId];
        if (b is not null && b.IsBurning && b.FireTruckId == v.Id)
        {
            b.FireTruckId = -1;
            b.FireStationId = v.OriginBuildingId;
            b.ExtinguishTicks = 15 + b.FireDamage / 4;
            return;
        }

        ReturnTruck(v.OriginBuildingId, v.Path[^1], tick);
    }

    public void OnTruckAborted(Vehicle v)
    {
        if (v.Purpose == TripPurpose.FireCall)
        {
            if (_sim.Buildings[v.TargetBuildingId] is { } b && b.FireTruckId == v.Id)
            {
                b.FireTruckId = 0;
            }

            ReleaseTruck(v.OriginBuildingId);
        }
        else
        {
            ReleaseTruck(v.TargetBuildingId);
        }
    }

    private static string Article(Building b)
    {
        string name = b.Spec.Name.ToLowerInvariant();
        return ("aeiou".Contains(name[0]) ? "an " : "a ") + name;
    }

    public static void Ignite(Building b)
    {
        b.FireDamage = 1;
        b.FireTruckId = 0;
        b.ExtinguishTicks = 0;
    }

    private void DispatchTruck(Building b, long tick)
    {
        if (b.AccessTile < 0)
        {
            return;
        }

        Building? best = null;
        int bestDistance = int.MaxValue;
        foreach (var station in _sim.Buildings)
        {
            if (station.Kind != BuildingKind.FireStation || !station.IsOperating || station.AccessTile < 0
                || station.TrucksOut >= station.Spec.Vehicles || !_sim.Roads.Connected(station.AccessTile, b.AccessTile))
            {
                continue;
            }

            int distance = Math.Abs(station.X - b.X) + Math.Abs(station.Y - b.Y);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = station;
            }
        }

        if (best is null)
        {
            return;
        }

        int vehicleId = _sim.Traffic.Dispatch(VehicleKind.FireTruck, TripPurpose.FireCall, 0, best.Id, b.Id,
            best.AccessTile, b.AccessTile, tick);
        if (vehicleId == 0)
        {
            return;
        }

        best.TrucksOut++;
        if (vehicleId < 0)
        {
            b.FireTruckId = -1;
            b.FireStationId = best.Id;
            b.ExtinguishTicks = 15 + b.FireDamage / 4;
        }
        else
        {
            b.FireTruckId = vehicleId;
        }
    }

    private void ReturnTruck(int stationId, int fromTile, long tick)
    {
        var station = _sim.Buildings[stationId];
        if (station is null || station.Kind != BuildingKind.FireStation)
        {
            return;
        }

        int vehicleId = _sim.Traffic.Dispatch(VehicleKind.FireTruck, TripPurpose.FireReturn, 0, 0, stationId,
            fromTile, station.AccessTile, tick);
        if (vehicleId <= 0)
        {
            ReleaseTruck(stationId);
        }
    }

    private void ReleaseTruck(int stationId)
    {
        if (_sim.Buildings[stationId] is { Kind: BuildingKind.FireStation } station && station.TrucksOut > 0)
        {
            station.TrucksOut--;
        }
    }

    private void SpreadFire(Building source)
    {
        var map = _sim.Map;
        var rng = _sim.Rng.Events;
        for (int y = source.Y - 1; y <= source.Y + source.Size; y++)
        {
            for (int x = source.X - 1; x <= source.X + source.Size; x++)
            {
                if (!map.InBounds(x, y) || source.Contains(x, y))
                {
                    continue;
                }

                int id = map.BuildingAt[map.Index(x, y)];
                if (id != 0 && _sim.Buildings[id] is { } nb && nb.Kind.IsZoned() && nb.IsOperating && !nb.IsBurning
                    && rng.Chance(1, SpreadOdds))
                {
                    Ignite(nb);
                    _sim.AddEvent(EventSeverity.Warning, "Fire is spreading!", map.Index(x, y));
                }
            }
        }
    }
}
