using CsCheck;
using MetroSim.Core.Buildings;
using MetroSim.Core.Economy;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.Serialization;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Properties;

/// <summary>Property-based tests: invariants checked over generated inputs (CsCheck shrinks failures).</summary>
public sealed class PropertyTests
{
    private sealed class UniformCost : IRoadCostModel
    {
        public int MinimumEntryCost => 1000;

        public int EntryCost(int tile, Direction travel) => 1000;
    }

    [Fact]
    public void Pcg32_Next_AlwaysWithinBound() =>
        Gen.Select(Gen.ULong, Gen.Int[1, int.MaxValue]).Sample((seed, bound) =>
        {
            var rng = new Pcg32(seed, 3);
            for (int i = 0; i < 20; i++)
            {
                int v = rng.Next(bound);
                Assert.InRange(v, 0, bound - 1);
            }
        }, iter: 500);

    [Fact]
    public void MinHeap_PopsInStableSortedOrder() =>
        Gen.Int[0, 50].List[0, 200].Sample(priorities =>
        {
            var heap = new MinHeap();
            for (int i = 0; i < priorities.Count; i++)
            {
                heap.Push(priorities[i], i);
            }

            var expected = priorities.Select((p, i) => (p, i)).OrderBy(x => x.p).ThenBy(x => x.i).Select(x => x.i).ToList();
            var actual = new List<int>();
            while (heap.Count > 0)
            {
                actual.Add(heap.Pop(out _));
            }

            Assert.Equal(expected, actual);
        }, iter: 300);

    [Fact]
    public void AStar_MatchesBreadthFirstShortestPath_OnRandomRoadGrids() =>
        Gen.Select(Gen.Bool.Array[20 * 20], Gen.Int[0, 399], Gen.Int[0, 399]).Sample((roads, a, b) =>
        {
            var sim = TestWorld.Flat(32);
            sim.Pathfinder.HeuristicWeightPercent = 100;
            var map = sim.Map;
            int Tile(int i) => map.Index(i % 20, i / 20);
            for (int i = 0; i < roads.Length; i++)
            {
                map.Roads[Tile(i)] = roads[i] || i == a || i == b ? RoadType.Street : RoadType.None;
            }

            map.TouchRoads();
            int start = Tile(a);
            int goal = Tile(b);
            var path = sim.Pathfinder.FindPath(start, goal, new UniformCost(), out int cost);
            var search = new RoadSearch(map);
            search.Run(start, int.MaxValue);
            int distance = search.DistanceOf(goal);
            if (distance < 0)
            {
                Assert.Null(path);
                return;
            }

            Assert.NotNull(path);
            Assert.Equal(distance, path!.Length - 1);
            Assert.Equal(distance * 1000, cost);
            Assert.Equal(start, path[0]);
            Assert.Equal(goal, path[^1]);
            for (int i = 1; i < path.Length; i++)
            {
                Assert.NotEqual(RoadType.None, map.Roads[path[i]]);
                int dx = Math.Abs(map.X(path[i]) - map.X(path[i - 1]));
                int dy = Math.Abs(map.Y(path[i]) - map.Y(path[i - 1]));
                Assert.Equal(1, dx + dy);
            }
        }, iter: 300);

    /// <summary>The default weighted A* never returns a route more than its weight above the optimum.</summary>
    [Fact]
    public void WeightedAStar_StaysWithinItsSuboptimalityBound() =>
        Gen.Select(Gen.Bool.Array[24 * 24], Gen.Int[0, 575], Gen.Int[0, 575], Gen.Bool.Array[24 * 24]).Sample((roads, a, b, avenues) =>
        {
            var sim = TestWorld.Flat(32);
            var map = sim.Map;
            int Tile(int i) => map.Index(i % 24, i / 24);
            for (int i = 0; i < roads.Length; i++)
            {
                bool road = roads[i] || i == a || i == b;
                map.Roads[Tile(i)] = !road ? RoadType.None : avenues[i] ? RoadType.Avenue : RoadType.Street;
            }

            map.TouchRoads();
            var weighted = sim.Pathfinder.FindPath(Tile(a), Tile(b), sim.Traffic, out int weightedCost);
            sim.Pathfinder.HeuristicWeightPercent = 100;
            var optimal = sim.Pathfinder.FindPath(Tile(a), Tile(b), sim.Traffic, out int optimalCost);
            Assert.Equal(optimal is null, weighted is null);
            Assert.True(weightedCost <= optimalCost * 125L / 100, $"{weightedCost} vs optimum {optimalCost}");
            Assert.True(weightedCost >= optimalCost);
        }, iter: 300);

    [Fact]
    public void Terrain_IsReproducible_AndHonoursWaterCoverage() =>
        Gen.Select(Gen.ULong, Gen.Int[32, 80], Gen.Int[32, 80], Gen.Int[0, 40]).Sample((seed, w, h, waterPercent) =>
        {
            var settings = new MapSettings { Seed = seed, Width = w, Height = h, WaterCoverage = waterPercent / 100.0, Rivers = 0 };
            var a = TerrainGenerator.Generate(settings);
            var b = TerrainGenerator.Generate(settings);
            Assert.Equal(a.Terrain, b.Terrain);
            Assert.Equal(a.Elevation, b.Elevation);
            double water = a.Terrain.Count(t => t == TerrainType.Water) / (double)a.TileCount;
            Assert.InRange(water, waterPercent / 100.0 - 0.06, waterPercent / 100.0 + 0.06);
        }, iter: 60);

    [Fact]
    public void Demand_AlwaysWithinRange_AndTaxNeverHelps() =>
        Gen.Select(Gen.Int[0, 50_000], Gen.Int[0, 30_000], Gen.Int[0, 30_000], Gen.Int[0, 60_000],
            Gen.Int[0, 20_000], Gen.Int[0, 20_000], Gen.Int[0, 100], Gen.Int[0, 28]).Sample(
            (pop, working, employed, cap, com, ind, sat, tax) =>
            {
                var inputs = new EconomyModel.DemandInputs(pop, working, Math.Min(employed, working), cap, com, ind, sat, tax, tax, tax);
                var d = EconomyModel.ComputeDemand(inputs);
                var higher = EconomyModel.ComputeDemand(inputs with { ResidentialTax = tax + 1, CommercialTax = tax + 1, IndustrialTax = tax + 1 });
                foreach (int v in new[] { d.Residential, d.Commercial, d.Industrial })
                {
                    Assert.InRange(v, -100, 100);
                }

                Assert.True(higher.Residential <= d.Residential);
                Assert.True(higher.Commercial <= d.Commercial);
                Assert.True(higher.Industrial <= d.Industrial);
            }, iter: 2_000);

    [Fact]
    public void Satisfaction_AlwaysWithinRange() =>
        Gen.Select(Gen.Bool, Gen.Bool, Gen.Bool, Gen.Int[0, 255], Gen.Int[0, 255], Gen.Int[0, 30], Gen.Int[0, 500], Gen.Int[0, 29])
            .Sample((power, water, garbage, pollution, land, days, commute, tax) =>
            {
                int s = EconomyModel.Satisfaction(new(power, water, garbage, power, water, pollution, land, true, days == 0, days, commute, tax));
                Assert.InRange(s, 0, 100);
            }, iter: 2_000);

    [Fact]
    public void Tax_IsMonotonicAndNeverExceedsTaxable() =>
        Gen.Select(Gen.Long[0, 1_000_000_000_000], Gen.Int[0, 29]).Sample((taxable, rate) =>
        {
            long tax = EconomyModel.Tax(taxable, rate);
            Assert.InRange(tax, 0, taxable);
            Assert.True(EconomyModel.Tax(taxable, Math.Min(29, rate + 1)) >= tax);
        }, iter: 2_000);

    /// <summary>Random player sessions on a small map never break cross-system consistency.</summary>
    [Fact]
    public void RandomCommandSessions_PreserveInvariants() =>
        CommandGenerators.Session(size: 40).Sample(session =>
        {
            var sim = Simulation.Create(new MapSettings { Width = 40, Height = 40, Seed = session.Seed });
            foreach (var step in session.Steps)
            {
                sim.Execute(step.Command);
                sim.Run(step.TicksAfter);
                Invariants.Check(sim);
            }
        }, iter: 40);

    /// <summary>Serialize → deserialize → serialize is the identity, for any reachable state.</summary>
    [Fact]
    public void Serialization_RoundTripsAnyReachableState() =>
        CommandGenerators.Session(size: 40).Sample(session =>
        {
            var sim = Simulation.Create(new MapSettings { Width = 40, Height = 40, Seed = session.Seed });
            foreach (var step in session.Steps)
            {
                sim.Execute(step.Command);
                sim.Run(step.TicksAfter);
            }

            var chunks = SimulationSerializer.Serialize(sim);
            var copy = SimulationSerializer.Deserialize(chunks);
            var again = SimulationSerializer.Serialize(copy);
            Assert.Equal(chunks.Select(c => c.Data), again.Select(c => c.Data));
            Invariants.Check(copy);
        }, iter: 25);
}

public sealed record SessionStep(GameCommand Command, int TicksAfter);

public sealed record Session(ulong Seed, IReadOnlyList<SessionStep> Steps)
{
    public override string ToString() => $"seed {Seed}: " + string.Join("; ", Steps.Select(s => $"{s.Command} +{s.TicksAfter}"));
}

internal static class CommandGenerators
{
    public static Gen<GameCommand> Command(int size)
    {
        var coord = Gen.Int[0, size - 1];
        var road = Gen.Select(coord, coord, coord, coord, Gen.Enum<RoadType>().Where(t => t != RoadType.None))
            .Select(t => (GameCommand)new BuildRoadCommand(t.Item1, t.Item2, t.Item3, t.Item4, t.Item5));
        var zone = Gen.Select(coord, coord, Gen.Int[0, 6], Gen.Int[0, 6], Gen.Enum<ZoneType>())
            .Select(t => (GameCommand)new ZoneCommand(t.Item1, t.Item2, Math.Min(size - 1, t.Item1 + t.Item3), Math.Min(size - 1, t.Item2 + t.Item4), t.Item5));
        var place = Gen.Select(Gen.Enum<BuildingKind>().Where(k => !k.IsZoned()), coord, coord)
            .Select(t => (GameCommand)new PlaceBuildingCommand(t.Item1, t.Item2, t.Item3));
        var bulldoze = Gen.Select(coord, coord, Gen.Int[0, 4], Gen.Int[0, 4])
            .Select(t => (GameCommand)new BulldozeCommand(t.Item1, t.Item2, t.Item1 + t.Item3, t.Item2 + t.Item4));
        var line = Gen.Select(coord, coord, coord, coord).Select(t => (GameCommand)new BuildPowerLineCommand(t.Item1, t.Item2, t.Item3, t.Item4));
        var tax = Gen.Select(Gen.Enum<ZoneType>(), Gen.Int[-2, 31]).Select(t => (GameCommand)new SetTaxCommand(t.Item1, t.Item2));
        return Gen.Frequency((5, road), (5, zone), (3, place), (2, bulldoze), (1, line), (1, tax));
    }

    public static Gen<Session> Session(int size) =>
        Gen.Select(Gen.ULong[1, 10_000], Gen.Select(Command(size), Gen.Int[0, 240], (c, t) => new SessionStep(c, t)).List[5, 30])
            .Select((seed, steps) => new Session(seed, steps));
}
