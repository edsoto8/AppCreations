using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class PathfinderTests
{
    private sealed class UniformCost : IRoadCostModel
    {
        public int MinimumEntryCost => 1000;

        public int EntryCost(int tile, Direction travel) => 1000;
    }

    private static Simulation ExactAStar(int size)
    {
        var sim = TestWorld.Flat(size);
        sim.Pathfinder.HeuristicWeightPercent = 100;
        return sim;
    }

    [Fact]
    public void FindPath_StraightRoad_ReturnsEveryTile()
    {
        var sim = ExactAStar(32);
        sim.Road(2, 5, 12, 5);
        var map = sim.Map;
        var path = sim.Pathfinder.FindPath(map.Index(2, 5), map.Index(12, 5), new UniformCost(), out int cost);
        Assert.NotNull(path);
        Assert.Equal(11, path!.Length);
        Assert.Equal(10_000, cost);
        Assert.Equal(map.Index(2, 5), path[0]);
        Assert.Equal(map.Index(12, 5), path[^1]);
    }

    [Fact]
    public void FindPath_Disconnected_ReturnsNull()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 5, 8, 5);
        sim.Road(10, 5, 14, 5);
        var map = sim.Map;
        Assert.Null(sim.Pathfinder.FindPath(map.Index(2, 5), map.Index(14, 5), new UniformCost(), out _));
        Assert.False(sim.Roads.Connected(map.Index(2, 5), map.Index(14, 5)));
    }

    [Fact]
    public void FindPath_NonRoadEndpoint_ReturnsNull()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 5, 8, 5);
        Assert.Null(sim.Pathfinder.FindPath(sim.Map.Index(2, 5), sim.Map.Index(3, 6), new UniformCost(), out _));
    }

    [Fact]
    public void FindPath_TakesDetourWhenDirectRoadIsRemoved()
    {
        var sim = ExactAStar(32);
        // A loop: two parallel roads joined at both ends.
        sim.Road(2, 5, 12, 5);
        sim.Road(2, 9, 12, 9);
        sim.Road(2, 5, 2, 9);
        sim.Road(12, 5, 12, 9);
        var map = sim.Map;
        var direct = sim.Pathfinder.FindPath(map.Index(4, 5), map.Index(10, 5), new UniformCost(), out _);
        Assert.Equal(7, direct!.Length);

        Assert.True(sim.Execute(new MetroSim.Core.Engine.BulldozeCommand(7, 5, 7, 5)).Success);
        var detour = sim.Pathfinder.FindPath(map.Index(4, 5), map.Index(10, 5), new UniformCost(), out _);
        Assert.NotNull(detour);
        Assert.Contains(map.Index(7, 9), detour!);
        Assert.DoesNotContain(map.Index(7, 5), detour!);
    }

    [Fact]
    public void FindPath_PrefersFasterAvenueWithTrafficCosts()
    {
        // Default (weighted) search: an avenue detour more than 25% faster must still win.
        var sim = TestWorld.Flat(40);
        // Short street route vs slightly longer avenue route.
        sim.Road(2, 10, 30, 10);
        sim.Road(2, 10, 2, 12, RoadType.Avenue);
        sim.Road(2, 12, 30, 12, RoadType.Avenue);
        sim.Road(30, 12, 30, 10, RoadType.Avenue);
        var map = sim.Map;
        var path = sim.Pathfinder.FindPath(map.Index(2, 10), map.Index(30, 10), sim.Traffic, out _);
        Assert.Contains(map.Index(16, 12), path!);
    }

    [Fact]
    public void RoadGraph_TracksComponentsAndIntersections()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 5, 12, 5);
        sim.Road(7, 2, 7, 10);
        sim.Road(20, 20, 25, 20);
        var map = sim.Map;
        Assert.Equal(2, sim.Roads.ComponentCount);
        Assert.True(sim.Roads.IsIntersection(map.Index(7, 5)));
        Assert.False(sim.Roads.IsIntersection(map.Index(4, 5)));
        Assert.True(sim.Roads.Connected(map.Index(2, 5), map.Index(7, 10)));
    }

    [Fact]
    public void RoadSearch_VisitsInDistanceOrderWithinRange()
    {
        var sim = TestWorld.Flat(32);
        sim.Road(2, 5, 20, 5);
        var search = new RoadSearch(sim.Map);
        search.Run(sim.Map.Index(10, 5), 3);
        Assert.Equal(7, search.VisitedCount);
        int last = 0;
        for (int k = 0; k < search.VisitedCount; k++)
        {
            int d = search.DistanceOf(search.Visited(k));
            Assert.True(d >= last);
            last = d;
        }

        Assert.Equal(-1, search.DistanceOf(sim.Map.Index(2, 5)));
    }
}
