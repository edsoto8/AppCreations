using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Infrastructure;
using MetroSim.Core.Traffic;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class ServiceTests
{
    [Fact]
    public void Coverage_MarksBuildingsWithinRoadRange()
    {
        var sim = TestWorld.Flat(80);
        sim.Road(1, 10, 78, 10);
        var station = sim.Finished(BuildingKind.FireStation, 2, 8);
        var near = sim.Finished(BuildingKind.Residential, 20, 9);
        var far = sim.Finished(BuildingKind.Residential, 60, 9);
        sim.Services.RecomputeCoverage();
        Assert.True(station.CoveredByFire);
        Assert.True(near.CoveredByFire);
        Assert.False(far.CoveredByFire);
        Assert.False(near.CoveredByHealth);
    }

    [Fact]
    public void Garbage_CollectedByNearestFirstUpToCapacity()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 10, 62, 10);
        var landfill = sim.Finished(BuildingKind.Landfill, 2, 7);
        var near = sim.Finished(BuildingKind.Residential, 10, 9);
        var far = sim.Finished(BuildingKind.Residential, 30, 9);
        near.Garbage = 1_000;
        far.Garbage = 1_000;
        sim.Services.CollectGarbage();
        int capacity = landfill.Spec.DailyCapacity;
        Assert.Equal(0, near.Garbage);
        Assert.Equal(2_000 + 2 - capacity, far.Garbage); // each house also produced 1 unit today
        Assert.Equal(capacity, landfill.Stored);
        Assert.Equal(capacity, sim.Stats.GarbageCapacityPerDay);
    }

    [Fact]
    public void Garbage_FullLandfillStopsCollecting_AndProblemDaysCount()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 10, 62, 10);
        var landfill = sim.Finished(BuildingKind.Landfill, 2, 7);
        landfill.Stored = landfill.Spec.StorageCapacity;
        var house = sim.Finished(BuildingKind.Residential, 10, 9);
        house.Garbage = 500;
        sim.Services.CollectGarbage();
        Assert.Equal(501, house.Garbage);
        Assert.Equal(1, house.DaysGarbage);
    }

    [Fact]
    public void Fire_CoveredBuilding_TruckDrivesOutAndExtinguishes()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 10, 62, 10);
        var station = sim.Finished(BuildingKind.FireStation, 2, 8);
        var house = sim.Finished(BuildingKind.Residential, 25, 9);
        sim.Services.RecomputeCoverage();
        Assert.True(house.CoveredByFire);
        ServiceSystem.Ignite(house);

        bool sawTruck = false;
        for (int i = 0; i < 400 && house.IsBurning; i++)
        {
            sim.Step();
            foreach (var v in sim.Traffic.Vehicles)
            {
                sawTruck |= v.Kind == VehicleKind.FireTruck && v.Purpose == TripPurpose.FireCall;
            }
        }

        Assert.True(sawTruck);
        Assert.False(house.IsBurning);
        Assert.NotNull(sim.Buildings[house.Id]);
        Assert.Equal(1, sim.Stats.FiresExtinguished);
        sim.Run(200);
        Assert.Equal(0, station.TrucksOut);
    }

    [Fact]
    public void BulldozingABuildingWhileATruckIsOnSite_SendsTheTruckHome()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 10, 62, 10);
        var station = sim.Finished(BuildingKind.FireStation, 2, 8);
        for (int round = 0; round < 4; round++)
        {
            var house = sim.Finished(BuildingKind.Residential, 20 + round, 9);
            sim.Services.RecomputeCoverage();
            ServiceSystem.Ignite(house);
            for (int i = 0; i < 300 && house.FireTruckId != -1; i++)
            {
                sim.Step();
            }

            Assert.Equal(-1, house.FireTruckId);
            Assert.True(sim.Execute(new BulldozeCommand(house.X, house.Y, house.X, house.Y)).Success);
            Invariants.Check(sim);
            sim.Run(200);
            Assert.Equal(0, station.TrucksOut);
        }
    }

    [Fact]
    public void ReplacingAStation_NewStationDoesNotInheritOldTrucks()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 10, 62, 10);
        var a = sim.Finished(BuildingKind.FireStation, 2, 8);
        var house = sim.Finished(BuildingKind.Residential, 25, 9);
        sim.Services.RecomputeCoverage();
        ServiceSystem.Ignite(house);
        for (int i = 0; i < 30 && a.TrucksOut == 0; i++)
        {
            sim.Step();
        }

        Assert.Equal(1, a.TrucksOut);
        Assert.True(sim.Execute(new BulldozeCommand(2, 8, 3, 9)).Success);
        Assert.True(sim.Execute(new PlaceBuildingCommand(BuildingKind.FireStation, 2, 8)).Success);
        var b = sim.Buildings[a.Id]!;
        Assert.Equal(BuildingKind.FireStation, b.Kind);
        Assert.Equal(0, b.TrucksOut);
        for (int i = 0; i < 400; i++)
        {
            sim.Step();
            Invariants.Check(sim);
        }
    }

    [Fact]
    public void Fire_UncoveredBuilding_BurnsDown()
    {
        var sim = TestWorld.Flat(40);
        sim.Road(1, 10, 38, 10);
        var house = sim.Finished(BuildingKind.Residential, 10, 9);
        var resident = sim.Resident(house);
        ServiceSystem.Ignite(house);
        sim.Run(250);
        Assert.Null(sim.Buildings[house.Id]);
        Assert.Null(sim.Citizens[resident.Id]);
        Assert.Equal(1, sim.Stats.BuildingsBurnedDown);
        Assert.Equal(MetroSim.Core.World.ZoneType.None, sim.Map.Zones[sim.Map.Index(10, 9)]);
    }

    [Fact]
    public void Pollution_SpreadsAroundIndustryAndLowersLandValue()
    {
        var sim = TestWorld.Flat(40);
        var factory = sim.Finished(BuildingKind.Industrial, 20, 20);
        sim.Land.Recompute();
        var map = sim.Map;
        Assert.True(map.Pollution[map.Index(20, 20)] > map.Pollution[map.Index(23, 20)]);
        Assert.Equal(0, map.Pollution[map.Index(30, 20)]);
        Assert.True(map.LandValue[map.Index(20, 20)] < map.LandValue[map.Index(30, 20)]);
        _ = factory;
    }
}
