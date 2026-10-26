using MetroSim.Core.Engine;
using MetroSim.Core.Serialization;
using MetroSim.Persistence;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Integration;

/// <summary>Deterministic replay: same inputs, same city — across runs, replays and save/load.</summary>
public sealed class DeterminismTests
{
    [Fact]
    public void SameSeedAndCommands_ProduceIdenticalState()
    {
        var a = new DemoRun().Days(4);
        var b = new DemoRun().Days(4);
        Assert.True(a.Sim.Stats.Population > 0);
        Assert.Equal(a.Sim.ComputeStateHash(), b.Sim.ComputeStateHash());
    }

    [Fact]
    public void DifferentSeeds_ProduceDifferentState()
    {
        var a = new DemoRun(seed: 1).Days(1);
        var b = new DemoRun(seed: 2).Days(1);
        Assert.NotEqual(a.Sim.ComputeStateHash(), b.Sim.ComputeStateHash());
    }

    [Fact]
    public void ReplayingTheCommandLog_RebuildsTheExactCity()
    {
        var run = new DemoRun().Days(5);
        Assert.True(run.Sim.CommandLog.Count > 20);
        var result = ReplayVerifier.Replay(run.Sim);
        Assert.True(result.Matches, $"expected {result.ExpectedHash}, got {result.ReplayedHash}");
        Assert.Equal(0, result.CommandsFailed);
        Assert.Equal(run.Sim.CommandLog.Count, result.CommandsReplayed);
    }

    /// <summary>
    /// Snapshot mid-run (cars on the road, construction in progress, mid-hour) and continue both copies:
    /// the restored copy must stay bit-identical to the original.
    /// </summary>
    [Theory]
    [InlineData(2 * Simulation.TicksPerDay + 8 * 60 + 17)]   // morning commute
    [InlineData(3 * Simulation.TicksPerDay + 17 * 60 + 59)]  // a minute before the hour, evening
    [InlineData(4 * Simulation.TicksPerDay)]                 // exactly midnight
    public void RestoredSnapshot_ContinuesIdentically(int ticks)
    {
        var original = new DemoRun().Ticks(ticks);
        Assert.True(original.Sim.Traffic.Vehicles.Count > 0 || ticks % Simulation.TicksPerDay == 0);
        var copy = SimulationSerializer.Deserialize(SimulationSerializer.Serialize(original.Sim));
        Assert.Equal(original.Sim.ComputeStateHash(), copy.ComputeStateHash());

        var copyMayor = new MetroSim.Core.Scenarios.AutoMayor(copy, original.Plan);
        MetroSim.Core.Scenarios.DemoCity.Run(original.Sim, original.Mayor, Simulation.TicksPerDay);
        MetroSim.Core.Scenarios.DemoCity.Run(copy, copyMayor, Simulation.TicksPerDay);
        Assert.Equal(original.Sim.ComputeStateHash(), copy.ComputeStateHash());
    }

    [Fact]
    public void SaveFileRoundTrip_ContinuesIdentically()
    {
        var original = new DemoRun().Ticks(3 * Simulation.TicksPerDay + 7 * 60 + 41);
        string path = TestWorld.TempPath("continue.city");
        SaveGameStore.Save(original.Sim, path);
        var loaded = SaveGameStore.Load(path);
        original.Sim.Run(Simulation.TicksPerDay);
        loaded.Run(Simulation.TicksPerDay);
        Assert.Equal(original.Sim.ComputeStateHash(), loaded.ComputeStateHash());
    }

    [Fact]
    public void Estimate_DoesNotPerturbTheFuture()
    {
        var a = new DemoRun().Days(2);
        var b = new DemoRun().Days(2);
        for (int i = 0; i < 50; i++)
        {
            a.Sim.Estimate(new BuildRoadCommand(i, i, i + 10, i + 5, MetroSim.Core.World.RoadType.Avenue));
            a.Sim.Estimate(new BulldozeCommand(i, i, i + 3, i + 3));
        }

        a.Days(1);
        b.Days(1);
        Assert.Equal(a.Sim.ComputeStateHash(), b.Sim.ComputeStateHash());
    }

    [Fact]
    public void Runner_StepNow_MatchesDirectStepping()
    {
        var direct = new DemoRun().Days(1);
        var threaded = new DemoRun();
        using var runner = new SimulationRunner(threaded.Sim) { HourlyHook = _ => threaded.Mayor.Manage() };
        runner.StepNow(Simulation.TicksPerDay);
        lock (runner.StateLock)
        {
            Assert.Equal(direct.Sim.ComputeStateHash(), threaded.Sim.ComputeStateHash());
        }
    }

    [Fact]
    public void Runner_BackgroundThread_AdvancesAndAppliesCommands()
    {
        var sim = TestWorld.Flat(48);
        using var runner = new SimulationRunner(sim) { Speed = SimulationSpeed.Unlimited };
        var result = runner.Execute(new BuildRoadCommand(2, 2, 20, 2, MetroSim.Core.World.RoadType.Street));
        Assert.True(result.Success);
        var deadline = DateTime.UtcNow.AddSeconds(10);
        long tick;
        do
        {
            Thread.Sleep(20);
            lock (runner.StateLock)
            {
                tick = runner.Simulation.Tick;
            }
        }
        while (tick < 2_000 && DateTime.UtcNow < deadline);

        runner.Speed = SimulationSpeed.Paused;
        Assert.True(tick >= 2_000, $"only {tick} ticks ran");
        lock (runner.StateLock)
        {
            Assert.Single(runner.Simulation.CommandLog);
        }
    }
}
