using MetroSim.Core.Engine;

namespace MetroSim.Cli;

internal static class Report
{
    public static void PrintHeader() =>
        Console.WriteLine("day |    pop |  jobs | empl% | unem | R/C/I demand  | bldg R/C/I/aband | power use/prod | water use/cap | peak cars | peak trips/h | peak TTI | commute | sat |      money | net/day | tick ms");

    public static void PrintDay(Simulation sim)
    {
        var s = sim.Stats;
        long net = sim.Budget.History.Count > 0 ? sim.Budget.History[^1].Net : 0;
        var day = sim.History.Samples.TakeLast(24).ToList();
        int peakCars = day.Count == 0 ? 0 : day.Max(h => h.Vehicles);
        int peakTrips = day.Count == 0 ? 0 : day.Max(h => h.CarTripsLastHour);
        int peakIndex = day.Count == 0 ? 100 : day.Max(h => h.TravelTimeIndex);
        int employedPct = s.WorkingAge == 0 ? 0 : s.Employed * 100 / s.WorkingAge;
        Console.WriteLine(
            $"{sim.Day,3} | {s.Population,6} | {s.Jobs,5} | {employedPct,4}% | {s.Unemployed,4} | " +
            $"{sim.Demand.Residential,4}/{sim.Demand.Commercial,4}/{sim.Demand.Industrial,4} | " +
            $"{s.ResidentialBuildings,4}/{s.CommercialBuildings,3}/{s.IndustrialBuildings,3}/{s.AbandonedBuildings,3} | " +
            $"{s.PowerDemand,6}/{s.PowerProduction,6} | {s.WaterDemand,6}/{s.WaterCapacity,5} | " +
            $"{peakCars,9} | {peakTrips,12} | {peakIndex / 100.0,8:0.00} | " +
            $"{s.AverageCommuteMinutes,5}m | {s.AverageSatisfaction,3} | {Money(sim.Budget.Money),10} | {Money(net),7} | " +
            $"{sim.Performance.AverageTickMilliseconds,6:0.000}");
    }

    public static void PrintSummary(Simulation sim)
    {
        var s = sim.Stats;
        var m = sim.Traffic.Metrics;
        Console.WriteLine();
        Console.WriteLine($"Population {s.Population} (children {s.Children}, working age {s.WorkingAge}, seniors {s.Seniors})");
        Console.WriteLine($"Births {s.TotalBirths}, deaths {s.TotalDeaths}, moved in {s.TotalMovedIn}, moved out {s.TotalMovedOut}");
        Console.WriteLine($"Trips started {m.TripsStarted}, completed {m.TripsCompleted}, aborted {m.TripsAborted}, reroutes {m.Reroutes}");
        Console.WriteLine($"Fires extinguished {s.FiresExtinguished}, buildings burned down {s.BuildingsBurnedDown}");
        Console.WriteLine($"Garbage uncollected {s.UncollectedGarbage}, landfill {s.LandfillUsedPercent}% full");
        Console.WriteLine($"Pathfinding: {sim.Pathfinder.Searches} searches, {sim.Pathfinder.NodesExpanded} nodes expanded, " +
            $"{sim.Pathfinder.ElapsedTicks * 1000.0 / System.Diagnostics.Stopwatch.Frequency:0} ms total");
        Console.WriteLine($"Ticks {sim.Performance.TicksExecuted}, mean {sim.Performance.TotalTickTimestamp * 1000.0 / System.Diagnostics.Stopwatch.Frequency / Math.Max(1, sim.Performance.TicksExecuted):0.000} ms/tick");
        Console.WriteLine($"State hash {sim.ComputeStateHash()}");
        Console.WriteLine("Recent events:");
        foreach (var e in sim.Events.Items.TakeLast(8))
        {
            Console.WriteLine($"  [{e.Severity}] day {e.Tick / Simulation.TicksPerDay}: {e.Message}");
        }
    }

    public static string Money(long cents) => (cents / 100).ToString("N0") ;
}
