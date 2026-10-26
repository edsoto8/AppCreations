using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Engine;
using MetroSim.Core.Roads;
using MetroSim.Core.Traffic;
using MetroSim.Core.World;

namespace MetroSim.Tests.Support;

/// <summary>Cross-system consistency rules that must hold between any two ticks.</summary>
internal static class Invariants
{
    /// <param name="checkMoney">False for scenarios that set the treasury directly.</param>
    public static void Check(Simulation sim, bool checkMoney = true)
    {
        var map = sim.Map;
        var residents = new Dictionary<int, int>();
        var workers = new Dictionary<int, int>();
        foreach (var c in sim.Citizens)
        {
            var home = sim.Buildings[c.HomeId];
            Assert.True(home is { Kind: BuildingKind.Residential }, $"citizen {c.Id} has no residential home");
            residents[c.HomeId] = residents.GetValueOrDefault(c.HomeId) + 1;
            if (c.JobId != 0)
            {
                var job = sim.Buildings[c.JobId];
                Assert.True(job is { Kind: BuildingKind.Commercial or BuildingKind.Industrial }, $"citizen {c.Id} works nowhere valid");
                Assert.True(c.IsWorkingAge, $"citizen {c.Id} works at age {c.Age}");
                workers[c.JobId] = workers.GetValueOrDefault(c.JobId) + 1;
            }

            if (c.IsTravelling)
            {
                var v = sim.Traffic.Vehicles[c.VehicleId];
                Assert.True(v is not null && v.CitizenId == c.Id, $"travelling citizen {c.Id} has no vehicle");
            }
            else
            {
                Assert.Equal(0, c.VehicleId);
            }
        }

        foreach (var b in sim.Buildings)
        {
            Assert.Equal(residents.GetValueOrDefault(b.Id), b.Residents);
            Assert.Equal(workers.GetValueOrDefault(b.Id), b.Workers);
            if (b.Kind.IsZoned() && b.IsOperating)
            {
                int occupancy = b.Kind == BuildingKind.Residential ? b.Residents : b.Workers;
                Assert.True(occupancy <= b.Capacity, $"building {b.Id} over capacity");
            }

            if (b.Kind == BuildingKind.FireStation)
            {
                Assert.InRange(b.TrucksOut, 0, b.Spec.Vehicles);
            }

            Assert.Equal(GrowthAccess(sim, b), b.AccessTile);
            for (int y = b.Y; y < b.Y + b.Size; y++)
            {
                for (int x = b.X; x < b.X + b.Size; x++)
                {
                    int t = map.Index(x, y);
                    Assert.Equal(b.Id, map.BuildingAt[t]);
                    Assert.Equal(RoadType.None, map.Roads[t]);
                    Assert.False(map.PowerLines[t]);
                }
            }
        }

        for (int t = 0; t < map.TileCount; t++)
        {
            int id = map.BuildingAt[t];
            if (id != 0)
            {
                Assert.True(sim.Buildings[id]?.Contains(map.X(t), map.Y(t)) == true, $"stale building id at tile {t}");
            }

            if (map.Zones[t] != ZoneType.None)
            {
                Assert.True(map.Terrain[t] is TerrainType.Grass or TerrainType.Sand && map.Roads[t] == RoadType.None && !map.PowerLines[t],
                    $"zone on unbuildable tile {t}");
            }
        }

        var lanes = new Dictionary<(int, int), int>();
        foreach (var v in sim.Traffic.Vehicles)
        {
            Assert.InRange(v.PathIndex, 0, v.Path.Length - 2);
            Assert.NotEqual(RoadType.None, map.Roads[v.CurrentTile]);
            Assert.InRange(v.Progress, 0, 1000);
            if (v.CitizenId != 0)
            {
                Assert.Equal(v.Id, sim.Citizens[v.CitizenId]?.VehicleId);
            }

            if (v.UsesLanes && v.InLane)
            {
                var key = (v.CurrentTile, (int)v.Lane);
                lanes[key] = lanes.GetValueOrDefault(key) + 1;
            }
        }

        foreach (var ((tile, lane), count) in lanes)
        {
            Assert.Equal(count, sim.Traffic.LaneOccupancy(tile, (MetroSim.Core.Mathematics.Direction)lane));
            Assert.True(count <= RoadSpecs.LaneCapacity(map.Roads[tile]) + 1, $"lane over capacity at {tile}");
        }

        if (!checkMoney)
        {
            return;
        }

        // Money is fully explained by the ledgers (history is never trimmed within a test's horizon).
        long net = 0;
        foreach (var day in sim.Budget.History)
        {
            net += day.Income - day.Upkeep - day.Construction;
        }

        Assert.Equal(MetroSim.Core.Economy.Budget.StartingMoney + net - sim.Budget.Today.Construction, sim.Budget.Money);
    }

    private static int GrowthAccess(Simulation sim, Building b) => sim.FindAccess(b.X, b.Y, b.Size);
}
