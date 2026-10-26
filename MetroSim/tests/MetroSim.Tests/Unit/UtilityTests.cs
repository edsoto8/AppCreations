using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class UtilityTests
{
    [Fact]
    public void Power_ReachesBuildingsWithinConductionRange()
    {
        var sim = TestWorld.Flat(40);
        var plant = sim.Finished(BuildingKind.CoalPlant, 2, 2);
        var near = sim.Finished(BuildingKind.Residential, 6, 3);   // 2 tiles from the plant's east edge (x=4)
        var far = sim.Finished(BuildingKind.Residential, 20, 3);
        sim.Utilities.Recompute();
        Assert.True(near.Powered);
        Assert.False(far.Powered);
        Assert.Equal(2_000, plant.PowerProduced);
    }

    [Fact]
    public void Power_TravelsAlongPowerLinesAndZones()
    {
        var sim = TestWorld.Flat(40);
        sim.Finished(BuildingKind.CoalPlant, 2, 2);
        var far = sim.Finished(BuildingKind.Residential, 20, 3);
        Assert.True(sim.Execute(new BuildPowerLineCommand(6, 3, 12, 3)).Success);
        sim.Execute(new ZoneCommand(13, 3, 18, 3, ZoneType.Industrial));
        sim.Utilities.Recompute();
        Assert.True(far.Powered);
    }

    [Fact]
    public void Power_ShortageLeavesFarthestConsumersDark_ServicesFirst()
    {
        var sim = TestWorld.Flat(64);
        var turbine = sim.Finished(BuildingKind.WindTurbine, 2, 2);
        sim.Map.Elevation[sim.Map.Index(2, 2)] = 0;   // 80 units of output
        var tower = sim.Finished(BuildingKind.WaterTower, 40, 2);
        var houses = new List<Building>();
        for (int x = 4; x <= 38; x += 2)
        {
            var house = sim.Finished(BuildingKind.Residential, x, 2);
            house.Level = 3;   // 11 units each
            houses.Add(house);
        }

        sim.Utilities.Recompute();
        Assert.True(tower.Powered);
        Assert.True(houses[0].Powered);
        Assert.False(houses[^1].Powered);
        int supplied = houses.Count(h => h.Powered) * 11 + tower.Spec.PowerUse;
        Assert.True(supplied <= 80);
        Assert.Equal(80, sim.Stats.PowerProduction);
        Assert.Equal(80, turbine.PowerProduced);
    }

    [Fact]
    public void Power_UnderConstructionPlantProducesNothing()
    {
        var sim = TestWorld.Flat(40);
        var plant = sim.Growth.CreateBuilding(BuildingKind.CoalPlant, 2, 2);
        var house = sim.Finished(BuildingKind.Residential, 6, 3);
        sim.Utilities.Recompute();
        Assert.Equal(0, plant.PowerProduced);
        Assert.False(house.Powered);
    }

    [Fact]
    public void WindOutput_RisesWithElevation()
    {
        Assert.True(MetroSim.Core.Infrastructure.UtilitySystem.WindOutput(200) > MetroSim.Core.Infrastructure.UtilitySystem.WindOutput(50));
    }

    [Fact]
    public void Water_FlowsThroughConnectedRoadsOnly()
    {
        var sim = TestWorld.Flat(40);
        sim.Road(2, 6, 30, 6);
        sim.Road(2, 20, 30, 20);
        sim.Finished(BuildingKind.CoalPlant, 2, 2);
        var tower = sim.Finished(BuildingKind.WaterTower, 5, 5);
        var connected = sim.Finished(BuildingKind.Residential, 6, 5);
        var other = sim.Finished(BuildingKind.Residential, 10, 19);
        sim.Utilities.Recompute();
        Assert.True(tower.Powered);
        Assert.True(connected.Watered);
        Assert.False(other.Watered);
        Assert.Equal(300, sim.Stats.WaterCapacity);
    }

    [Fact]
    public void Water_UnpoweredPumpSuppliesNothing()
    {
        var sim = TestWorld.Flat(40);
        sim.Road(2, 6, 30, 6);
        sim.Finished(BuildingKind.WaterTower, 5, 5);
        var house = sim.Finished(BuildingKind.Residential, 6, 5);
        sim.Utilities.Recompute();
        Assert.False(house.Watered);
        Assert.Equal(0, sim.Stats.WaterCapacity);
    }

    [Fact]
    public void Water_CapacityExhaustion_NearestServedFirst()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(1, 6, 62, 6);
        sim.Finished(BuildingKind.CoalPlant, 1, 1);
        sim.Execute(new BuildPowerLineCommand(4, 2, 62, 2));
        sim.Finished(BuildingKind.WaterTower, 2, 5);    // 300 units
        var houses = new List<Building>();
        for (int x = 4; x < 62; x++)
        {
            var house = sim.Finished(BuildingKind.Residential, x, 7);
            house.Level = 3;  // 12 water each
            houses.Add(house);
        }

        sim.Utilities.Recompute();
        int watered = houses.Count(h => h.Watered);
        Assert.Equal(300 / 12, watered);
        Assert.True(houses[0].Watered);
        Assert.False(houses[^1].Watered);
    }
}
