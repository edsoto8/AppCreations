using System.Diagnostics;
using MetroSim.Core.Citizens;
using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Stress;

/// <summary>Large populations. Filter with <c>--filter "Category=Stress"</c> (or exclude them).</summary>
[Trait("Category", "Stress")]
public sealed class StressTests(ITestOutputHelper output)
{
    [Fact]
    public void TwentyThousandCitizens_CommuteForAFullDay_WithInvariantsIntact()
    {
        var sim = SyntheticCity.Build(160, 20_000);
        Assert.True(sim.Citizens.Count >= 20_000, $"only {sim.Citizens.Count} citizens fit");
        int employed = sim.Citizens.Count(c => c.JobId != 0);
        Assert.True(employed > 18_000);

        var watch = Stopwatch.StartNew();
        int peakVehicles = 0;
        for (int t = 0; t < Simulation.TicksPerDay; t++)
        {
            sim.Step();
            peakVehicles = Math.Max(peakVehicles, sim.Traffic.Vehicles.Count);
        }

        watch.Stop();
        double msPerTick = watch.Elapsed.TotalMilliseconds / Simulation.TicksPerDay;
        output.WriteLine($"{sim.Citizens.Count} citizens, {employed} employed: {msPerTick:0.000} ms/tick, peak {peakVehicles} vehicles, " +
            $"{sim.Traffic.Metrics.TripsCompleted} trips, {sim.Pathfinder.Searches} searches, peak TTI {sim.History.Samples.Max(h => h.TravelTimeIndex)}");
        Assert.True(peakVehicles > 2_000);
        Assert.True(sim.Traffic.Metrics.TripsCompleted > employed);
        Assert.True(msPerTick < 25, $"{msPerTick:0.00} ms per tick");
        Invariants.Check(sim, checkMoney: false);
    }

    [Fact]
    public void DemoCity_ThirtyDays_StaysConsistentAndFast()
    {
        var run = new DemoRun(size: 128, blocks: 6);
        var watch = Stopwatch.StartNew();
        for (int day = 0; day < 30; day++)
        {
            run.Days(1);
            Invariants.Check(run.Sim);
        }

        watch.Stop();
        var s = run.Sim.Stats;
        output.WriteLine($"day 30: population {s.Population}, {watch.Elapsed.TotalSeconds:0.0}s, {run.Sim.Performance.AverageTickMilliseconds:0.000} ms/tick (last 256)");
        Assert.True(s.Population > 2_500, $"population {s.Population}");
    }

    [Fact]
    public void LongRun_HundredDaySmallCity_NoDriftInAccounting()
    {
        var run = new DemoRun().Days(100);
        Invariants.Check(run.Sim);
        Assert.True(run.Sim.Citizens.All(c => c.Age >= 0 && c.Age < 101));
        Assert.Equal(Math.Min(100, MetroSim.Core.Economy.Budget.HistoryDays), run.Sim.Budget.History.Count);
        Assert.DoesNotContain(run.Sim.Citizens, c => c.State == CitizenState.AtWork && c.JobId == 0);
    }
}
