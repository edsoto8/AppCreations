using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Roads;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class CommandTests
{
    [Fact]
    public void BuildRoad_ChargesPerTileAndLogsCommand()
    {
        var sim = TestWorld.Flat(32);
        long before = sim.Budget.Money;
        var result = sim.Road(2, 2, 11, 2);
        Assert.Equal(10, result.TilesAffected);
        Assert.Equal(10 * RoadSpecs.BuildCostPerTile(RoadType.Street), result.Cost);
        Assert.Equal(before - result.Cost, sim.Budget.Money);
        Assert.Equal(result.Cost, sim.Budget.Today.Construction);
        Assert.Single(sim.CommandLog);
    }

    [Fact]
    public void BuildRoad_LPathGoesHorizontalThenVertical()
    {
        var tiles = CommandPaths.LPath(1, 1, 4, 3);
        Assert.Equal([(1, 1), (2, 1), (3, 1), (4, 1), (4, 2), (4, 3)], tiles);
        Assert.Equal([(5, 5)], CommandPaths.LPath(5, 5, 5, 5));
        Assert.Equal([(3, 3), (3, 2), (3, 1)], CommandPaths.LPath(3, 3, 3, 1));
    }

    [Fact]
    public void BuildRoad_BridgeOverWaterCostsFourTimes()
    {
        var sim = TestWorld.Flat(32);
        sim.Map.Terrain[sim.Map.Index(5, 5)] = TerrainType.Water;
        var result = sim.Road(4, 5, 6, 5);
        Assert.Equal(6 * RoadSpecs.BuildCostPerTile(RoadType.Street), result.Cost);
    }

    [Fact]
    public void BuildRoad_UpgradeToAvenueChargesOnlyChangedTiles()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 2, 6, 2);
        var upgrade = sim.Road(2, 2, 8, 2, RoadType.Avenue);
        Assert.Equal(7, upgrade.TilesAffected);
        var again = sim.Execute(new BuildRoadCommand(2, 2, 8, 2, RoadType.Avenue));
        Assert.False(again.Success);
    }

    [Fact]
    public void BuildRoad_BlockedByBuilding_FailsWithoutChanges()
    {
        var sim = TestWorld.Flat(32);
        sim.Finished(BuildingKind.Residential, 5, 2);
        string hash = sim.ComputeStateHash();
        var result = sim.Execute(new BuildRoadCommand(2, 2, 8, 2, RoadType.Street));
        Assert.False(result.Success);
        Assert.Equal(hash, sim.ComputeStateHash());
    }

    [Fact]
    public void Command_InsufficientFunds_Fails()
    {
        var sim = TestWorld.Flat(32);
        sim.Budget.Money = 1_000;
        var result = sim.Execute(new PlaceBuildingCommand(BuildingKind.CoalPlant, 5, 5));
        Assert.False(result.Success);
        Assert.Equal("Not enough money.", result.Message);
        Assert.Equal(BuildingCatalog.Get(BuildingKind.CoalPlant).BuildCost, result.Cost);
        Assert.Equal(0, sim.Buildings.Count);
    }

    [Fact]
    public void Estimate_NeverChangesState()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 2, 20, 2);
        string hash = sim.ComputeStateHash();
        Assert.True(sim.Estimate(new BuildRoadCommand(2, 4, 20, 4, RoadType.Avenue)).Success);
        Assert.True(sim.Estimate(new ZoneCommand(2, 3, 20, 3, ZoneType.Residential)).Success);
        Assert.True(sim.Estimate(new PlaceBuildingCommand(BuildingKind.FireStation, 4, 5)).Success);
        Assert.True(sim.Estimate(new BulldozeCommand(2, 2, 5, 2)).Success);
        Assert.Equal(hash, sim.ComputeStateHash());
    }

    [Fact]
    public void Zone_OnlyPaintsBuildableLand()
    {
        var sim = TestWorld.Flat(32);
        sim.Map.Terrain[sim.Map.Index(3, 3)] = TerrainType.Water;
        sim.Map.Terrain[sim.Map.Index(4, 3)] = TerrainType.Rock;
        sim.Road(2, 4, 6, 4);
        var result = sim.Execute(new ZoneCommand(2, 3, 6, 4, ZoneType.Residential));
        Assert.True(result.Success);
        Assert.Equal(3, result.TilesAffected);
        Assert.Equal(ZoneType.None, sim.Map.Zones[sim.Map.Index(3, 3)]);
        Assert.Equal(ZoneType.None, sim.Map.Zones[sim.Map.Index(2, 4)]);
        Assert.Equal(ZoneType.Residential, sim.Map.Zones[sim.Map.Index(5, 3)]);
    }

    [Fact]
    public void Zone_Dezone_DemolishesZonedBuilding()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 4, 6, 4);
        sim.Execute(new ZoneCommand(3, 3, 3, 3, ZoneType.Residential));
        var house = sim.Finished(BuildingKind.Residential, 3, 3);
        sim.Resident(house);
        Assert.True(sim.Execute(new ZoneCommand(3, 3, 3, 3, ZoneType.None)).Success);
        Assert.Null(sim.Buildings[house.Id]);
        Assert.Equal(0, sim.Citizens.Count);
        Assert.Equal(0, sim.Map.BuildingAt[sim.Map.Index(3, 3)]);
    }

    [Fact]
    public void PlaceBuilding_WaterPumpNeedsWater()
    {
        var sim = TestWorld.Flat(32);
        Assert.False(sim.Execute(new PlaceBuildingCommand(BuildingKind.WaterPump, 10, 10)).Success);
        sim.Map.Terrain[sim.Map.Index(12, 10)] = TerrainType.Water;
        Assert.True(sim.Execute(new PlaceBuildingCommand(BuildingKind.WaterPump, 10, 10)).Success);
    }

    [Fact]
    public void PlaceBuilding_RejectsZonedKindsOverlapAndEdges()
    {
        var sim = TestWorld.Flat(32);
        Assert.False(sim.Execute(new PlaceBuildingCommand(BuildingKind.Residential, 5, 5)).Success);
        Assert.False(sim.Execute(new PlaceBuildingCommand(BuildingKind.CoalPlant, 30, 30)).Success);
        Assert.True(sim.Execute(new PlaceBuildingCommand(BuildingKind.CoalPlant, 5, 5)).Success);
        Assert.False(sim.Execute(new PlaceBuildingCommand(BuildingKind.Clinic, 6, 6)).Success);
    }

    [Fact]
    public void PlaceBuilding_OccupiesFootprintAndFindsAccess()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 9, 20, 9);
        Assert.True(sim.Execute(new PlaceBuildingCommand(BuildingKind.FireStation, 5, 7)).Success);
        var station = sim.Buildings[1]!;
        Assert.Equal(2, station.Size);
        Assert.Equal(sim.Map.Index(5, 9), station.AccessTile);
        Assert.Equal(station.Id, sim.Map.BuildingAt[sim.Map.Index(6, 8)]);
        Assert.Equal(BuildingCatalog.Get(BuildingKind.FireStation).ConstructionHours, station.ConstructionHours);
    }

    [Fact]
    public void Bulldoze_RemovesRoadsBuildingsAndLines_AndUpdatesAccess()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 9, 20, 9);
        var house = sim.Finished(BuildingKind.Residential, 5, 8);
        Assert.True(sim.Execute(new BuildPowerLineCommand(10, 5, 15, 5)).Success);
        Assert.True(house.AccessTile >= 0);
        var result = sim.Execute(new BulldozeCommand(2, 9, 20, 9));
        Assert.True(result.Success);
        Assert.Equal(-1, house.AccessTile);
        Assert.Equal(19 * RoadSpecs.BulldozeRoadCostPerTile, result.Cost);
        Assert.True(sim.Execute(new BulldozeCommand(10, 5, 15, 5)).Success);
        Assert.DoesNotContain(true, sim.Map.PowerLines);
        Assert.True(sim.Execute(new BulldozeCommand(5, 8, 5, 8)).Success);
        Assert.Equal(0, sim.Buildings.Count);
    }

    [Fact]
    public void Bulldoze_RoadUnderVehicle_AbortsTrip()
    {
        var sim = TestWorld.Flat(40);
        sim.Road(2, 10, 35, 10);
        var map = sim.Map;
        int id = sim.Traffic.Dispatch(MetroSim.Core.Traffic.VehicleKind.Car, MetroSim.Core.Traffic.TripPurpose.ToWork, 0, 0, 0,
            map.Index(2, 10), map.Index(35, 10), sim.Tick);
        Assert.True(id > 0);
        Assert.True(sim.Execute(new BulldozeCommand(2, 10, 2, 10)).Success);
        Assert.Equal(0, sim.Traffic.Vehicles.Count);
        Assert.Equal(1, sim.Traffic.Metrics.TripsAborted);
    }

    [Fact]
    public void SetTax_ValidatesRange()
    {
        var sim = TestWorld.Flat(32);
        Assert.True(sim.Execute(new SetTaxCommand(ZoneType.Residential, 15)).Success);
        Assert.Equal(15, sim.Budget.ResidentialTax);
        Assert.False(sim.Execute(new SetTaxCommand(ZoneType.Residential, 40)).Success);
        Assert.False(sim.Execute(new SetTaxCommand(ZoneType.None, 5)).Success);
    }

    [Fact]
    public void Commands_WithUndefinedEnumValues_AreRejected()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 4, 20, 4);
        Assert.False(sim.Execute(new ZoneCommand(2, 3, 8, 3, (ZoneType)9)).Success);
        Assert.False(sim.Execute(new BuildRoadCommand(2, 6, 8, 6, (RoadType)7)).Success);
        Assert.False(sim.Execute(new PlaceBuildingCommand((BuildingKind)42, 5, 8)).Success);
        Assert.False(sim.Execute(new SetTaxCommand((ZoneType)9, 5)).Success);
        Assert.Single(sim.CommandLog);
        sim.RunHours(2);
    }

    [Fact]
    public void FailedCommands_AreNotLogged()
    {
        var sim = TestWorld.Flat(32);
        sim.Execute(new SetTaxCommand(ZoneType.Residential, 99));
        sim.Execute(new BulldozeCommand(1, 1, 3, 3));
        Assert.Empty(sim.CommandLog);
    }
}
