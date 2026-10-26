using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.Traffic;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class TrafficTests
{
    private static int Dispatch(Simulation sim, int fromTile, int toTile) =>
        sim.Traffic.Dispatch(VehicleKind.Car, TripPurpose.ToWork, 0, 0, 0, fromTile, toTile, sim.Tick);

    [Fact]
    public void SingleCar_TravelsAtFreeFlowSpeed()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 42, 10);
        var map = sim.Map;
        int id = Dispatch(sim, map.Index(2, 10), map.Index(42, 10));
        Assert.True(id > 0);
        var v = sim.Traffic.Vehicles[id]!;
        Assert.Equal(VehicleKind.Car, v.Kind);
        Assert.Equal(40, v.FreeFlowTicks);
        int ticks = 0;
        while (sim.Traffic.Vehicles[id] is not null && ticks < 200)
        {
            sim.Step();
            ticks++;
        }

        Assert.InRange(ticks, 39, 41);
        Assert.Equal(1, sim.Traffic.Metrics.TripsCompleted);
    }

    [Fact]
    public void ShortTrip_IsWalked()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 10, 20, 10);
        int id = Dispatch(sim, sim.Map.Index(2, 10), sim.Map.Index(5, 10));
        Assert.Equal(VehicleKind.Pedestrian, sim.Traffic.Vehicles[id]!.Kind);
        sim.Run(20);
        Assert.Null(sim.Traffic.Vehicles[id]);
    }

    [Fact]
    public void SameTileTrip_CompletesInstantly()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 10, 20, 10);
        Assert.Equal(-1, Dispatch(sim, sim.Map.Index(4, 10), sim.Map.Index(4, 10)));
    }

    [Fact]
    public void UnreachableTrip_IsRefused()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 10, 8, 10);
        sim.Road(12, 10, 20, 10);
        Assert.Equal(0, Dispatch(sim, sim.Map.Index(2, 10), sim.Map.Index(20, 10)));
    }

    [Fact]
    public void HeavyDemand_CreatesCongestion_AndLanesNeverExceedCapacity()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 60, 10);
        var map = sim.Map;
        for (int i = 0; i < 120; i++)
        {
            Dispatch(sim, map.Index(2, 10), map.Index(60, 10));
        }

        int capacity = RoadSpecs.LaneCapacity(RoadType.Street);
        long completedBefore = sim.Traffic.Metrics.TripsCompleted;
        for (int t = 0; t < 600 && sim.Traffic.Vehicles.Count > 0; t++)
        {
            sim.Step();
            for (int tile = map.Index(2, 10); tile <= map.Index(60, 10); tile++)
            {
                Assert.True(sim.Traffic.LaneOccupancy(tile, Direction.East) <= capacity);
            }
        }

        Assert.Equal(0, sim.Traffic.Vehicles.Count);
        Assert.Equal(completedBefore + 120, sim.Traffic.Metrics.TripsCompleted);
        sim.Traffic.RollHour();
        Assert.True(sim.Traffic.Metrics.TravelTimeIndex > 150, $"TTI {sim.Traffic.Metrics.TravelTimeIndex}");
    }

    [Fact]
    public void OppositeDirections_UseSeparateLanes()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 60, 10);
        var map = sim.Map;
        int east = Dispatch(sim, map.Index(2, 10), map.Index(60, 10));
        int west = Dispatch(sim, map.Index(60, 10), map.Index(2, 10));
        Assert.Equal(Direction.East, sim.Traffic.Vehicles[east]!.Lane);
        Assert.Equal(Direction.West, sim.Traffic.Vehicles[west]!.Lane);
        sim.Run(80);
        Assert.Equal(2, sim.Traffic.Metrics.TripsCompleted);
    }

    [Fact]
    public void RemovedRoadAhead_TriggersReroute()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 40, 10);
        sim.Road(2, 14, 40, 14);
        sim.Road(2, 10, 2, 14);
        sim.Road(40, 10, 40, 14);
        var map = sim.Map;
        var target = sim.Finished(MetroSim.Core.Buildings.BuildingKind.Industrial, 38, 9);
        int id = sim.Traffic.Dispatch(VehicleKind.Car, TripPurpose.ToWork, 0, 0, target.Id, map.Index(4, 10), target.AccessTile, sim.Tick);
        sim.Run(5);
        Assert.True(sim.Execute(new BulldozeCommand(30, 10, 30, 10)).Success);
        sim.Run(200);
        Assert.Null(sim.Traffic.Vehicles[id]);
        Assert.Equal(1, sim.Traffic.Metrics.TripsCompleted);
        Assert.True(sim.Traffic.Metrics.Reroutes >= 1);
    }

    [Fact]
    public void Congestion_RaisesRouteCost_SoNewTripsAvoidJams()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 40, 10);
        var map = sim.Map;
        int freeCost = sim.Traffic.EntryCost(map.Index(6, 10), Direction.East);
        for (int i = 0; i < 60; i++)
        {
            Dispatch(sim, map.Index(2, 10), map.Index(40, 10));
        }

        sim.Run(15);
        int jammedCost = sim.Traffic.EntryCost(map.Index(6, 10), Direction.East);
        Assert.True(jammedCost > freeCost);
    }
}
