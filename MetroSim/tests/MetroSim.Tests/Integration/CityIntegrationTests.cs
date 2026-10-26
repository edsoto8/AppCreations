using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Core.Serialization;
using MetroSim.Core.World;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Integration;

/// <summary>Cross-system behaviour of whole cities: the acceptance loop, plus cause and effect.</summary>
public sealed class CityIntegrationTests
{
    private static Simulation Clone(Simulation sim) => SimulationSerializer.Deserialize(SimulationSerializer.Serialize(sim));

    [Fact]
    public void DemoCity_GrowsIntoAFunctioningCity()
    {
        var run = new DemoRun().Days(10);
        var sim = run.Sim;
        var s = sim.Stats;
        Assert.True(s.Population > 300, $"population {s.Population}");
        Assert.True(s.ResidentialBuildings > 50 && s.CommercialBuildings > 5 && s.IndustrialBuildings > 10);
        Assert.True(s.Employed * 100 / Math.Max(1, s.WorkingAge) > 80, "most adults should be employed");
        Assert.True(sim.Traffic.Metrics.TripsCompleted > 2_000);
        Assert.True(s.PowerProduction > 0 && s.WaterCapacity > 0);
        Assert.Equal(10, sim.Budget.History.Count);
        Assert.Contains(sim.Budget.History, d => d.ResidentialTax > 0 && d.IndustrialTax > 0 && d.Upkeep > 0);
        Invariants.Check(sim);

        // Mid-morning on a working day most employed citizens are at work or on the way.
        run.Ticks(11 * 60);
        int employed = sim.Citizens.Count(c => c.JobId != 0);
        int atWork = sim.Citizens.Count(c => c.State is CitizenState.AtWork or CitizenState.ToWork);
        Assert.True(atWork * 100 / employed > 70, $"{atWork}/{employed} at work");
    }

    [Fact]
    public void RemovingPowerPlants_CausesBlackoutAbandonmentAndPopulationLoss()
    {
        var control = new DemoRun().Days(6).Sim;
        var blackout = Clone(control);
        foreach (var plant in blackout.Buildings.Where(b => b.Spec.PowerOutput > 0).ToList())
        {
            Assert.True(blackout.Execute(new BulldozeCommand(plant.X, plant.Y, plant.X, plant.Y)).Success);
        }

        blackout.Run(20);
        Assert.Equal(0, blackout.Stats.PowerProduction);
        Assert.True(blackout.Stats.UnpoweredBuildings > 50);

        control.RunDays(6);
        blackout.RunDays(6);
        Assert.True(blackout.Stats.AbandonedBuildings > control.Stats.AbandonedBuildings + 20);
        Assert.True(blackout.Stats.Population < control.Stats.Population / 2,
            $"blackout {blackout.Stats.Population} vs control {control.Stats.Population}");
        Assert.Contains(blackout.Events.Items, e => e.Message.Contains("no electricity"));
    }

    [Fact]
    public void RemovingWaterSupply_LowersSatisfaction()
    {
        var control = new DemoRun().Days(5).Sim;
        var dry = Clone(control);
        foreach (var source in dry.Buildings.Where(b => b.Spec.WaterOutput > 0).ToList())
        {
            dry.Execute(new BulldozeCommand(source.X, source.Y, source.X, source.Y));
        }

        control.RunDays(2);
        dry.RunDays(2);
        Assert.Equal(0, dry.Stats.WaterCapacity);
        Assert.True(dry.Stats.AverageSatisfaction < control.Stats.AverageSatisfaction - 10);
    }

    [Fact]
    public void RaisingTaxes_RaisesIncomeNow_ButSlowsGrowth()
    {
        var low = new DemoRun().Days(4).Sim;
        var high = Clone(low);
        Assert.True(high.Execute(new SetTaxCommand(ZoneType.Residential, 20)).Success);
        Assert.True(high.Execute(new SetTaxCommand(ZoneType.Commercial, 20)).Success);
        Assert.True(high.Execute(new SetTaxCommand(ZoneType.Industrial, 20)).Success);
        low.RunDays(1);
        high.RunDays(1);
        Assert.True(high.Budget.History[^1].Income > low.Budget.History[^1].Income * 3 / 2);
        Assert.True(high.Demand.Residential < low.Demand.Residential);

        low.RunDays(6);
        high.RunDays(6);
        Assert.True(high.Stats.Population < low.Stats.Population, $"high {high.Stats.Population} vs low {low.Stats.Population}");
    }

    [Fact]
    public void WithoutGarbageService_GarbagePilesUpAndBuildingsAreAbandoned()
    {
        var run = new DemoRun();
        var sim = run.Sim;
        // Grow without the mayor so no landfill is ever built.
        sim.RunDays(12);
        Assert.Equal(0, sim.Buildings.Count(b => b.Spec.Category == ServiceCategory.Garbage));
        Assert.True(sim.Stats.UncollectedGarbage > 1_000);
        Assert.Contains(sim.Events.Items, e => e.Message.Contains("uncollected garbage") || e.Message.Contains("garbage are piling up"));
    }

    [Fact]
    public void MoreCommuters_OnOneCorridor_RaiseTravelTime_AndAnAvenueRelievesIt()
    {
        static (int Tti, double Commute) Measure(int commuters, RoadType corridor)
        {
            var sim = TestWorld.Flat(64);
            sim.Budget.Money = long.MaxValue / 4;
            sim.Road(2, 10, 60, 10, corridor);
            var homes = new List<Building>();
            var jobs = new List<Building>();
            for (int x = 2; x <= 12; x++)
            {
                homes.Add(Level3(sim.Finished(BuildingKind.Residential, x, 9)));
                homes.Add(Level3(sim.Finished(BuildingKind.Residential, x, 11)));
                jobs.Add(Level3(sim.Finished(BuildingKind.Industrial, x + 48, 9)));
                jobs.Add(Level3(sim.Finished(BuildingKind.Industrial, x + 48, 11)));
            }

            int created = 0;
            var ours = new List<Citizen>();
            foreach (var home in homes)
            {
                for (int i = 0; i < home.Capacity && created < commuters; i++, created++)
                {
                    var job = jobs[created % jobs.Count];
                    var c = sim.Resident(home);
                    sim.Employ(c, job, 7 * 60 + created % 60);
                    ours.Add(c);
                }
            }

            // By 14:30 everyone has arrived and nobody has left yet, so the average is unbiased.
            sim.RunUntilMinute(14 * 60 + 30);
            Assert.All(ours, c => Assert.Equal(CitizenState.AtWork, c.State));
            int worst = sim.History.Samples.Max(h => h.TravelTimeIndex);
            return (worst, ours.Average(c => (double)c.LastCommuteMinutes));
        }

        var light = Measure(40, RoadType.Street);
        var heavy = Measure(600, RoadType.Street);
        var avenue = Measure(600, RoadType.Avenue);
        Assert.True(heavy.Tti > light.Tti + 50, $"light {light.Tti}, heavy {heavy.Tti}");
        Assert.True(heavy.Commute > light.Commute * 1.5, $"light {light.Commute:0}m, heavy {heavy.Commute:0}m");
        Assert.True(avenue.Commute < heavy.Commute * 0.7, $"street {heavy.Commute:0}m, avenue {avenue.Commute:0}m");
    }

    [Fact]
    public void FireStation_ReducesBuildingsLostToFire()
    {
        static long Burned(bool withStation)
        {
            var sim = SyntheticCity.Build(64, 2_000);
            if (withStation)
            {
                foreach (var (x, y) in new[] { (20, 20), (44, 44), (20, 44), (44, 20) })
                {
                    // Clear a 2x2 lot with road access and put a station on it.
                    var spot = sim.Buildings.First(b => b.Kind.IsZoned() && Math.Abs(b.X - x) < 6 && Math.Abs(b.Y - y) < 6
                        && sim.Map.BuildingAt[sim.Map.Index(b.X + 1, b.Y)] != 0 && sim.Map.BuildingAt[sim.Map.Index(b.X, b.Y + 1)] != 0
                        && sim.Map.BuildingAt[sim.Map.Index(b.X + 1, b.Y + 1)] != 0);
                    sim.Execute(new BulldozeCommand(spot.X, spot.Y, spot.X + 1, spot.Y + 1));
                    Assert.True(sim.Execute(new PlaceBuildingCommand(BuildingKind.FireStation, spot.X, spot.Y)).Success);
                }
            }

            // Many fires at once so the comparison does not hinge on rare random ignitions.
            sim.RunHours(3);
            foreach (var station in sim.Buildings.Where(b => b.Kind == BuildingKind.FireStation))
            {
                station.ConstructionHours = 0;
            }

            sim.Services.RecomputeCoverage();
            int i = 0;
            foreach (var b in sim.Buildings.Where(b => b.Kind.IsZoned()).ToList())
            {
                if (i++ % 25 == 0)
                {
                    MetroSim.Core.Infrastructure.ServiceSystem.Ignite(b);
                }
            }

            sim.RunHours(8);
            return sim.Stats.BuildingsBurnedDown;
        }

        long without = Burned(false);
        long with = Burned(true);
        Assert.True(with < without / 2, $"with station {with}, without {without}");
    }

    private static Building Level3(Building b)
    {
        b.Level = 3;
        return b;
    }
}
