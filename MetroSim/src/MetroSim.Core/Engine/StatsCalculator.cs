using MetroSim.Core.Buildings;

namespace MetroSim.Core.Engine;

internal static class StatsCalculator
{
    public static void Recompute(Simulation sim)
    {
        var s = sim.Stats;
        int population = 0, children = 0, working = 0, seniors = 0, employed = 0, satisfactionSum = 0;
        long commuteSum = 0;
        int commuters = 0;
        foreach (var c in sim.Citizens)
        {
            population++;
            satisfactionSum += c.Satisfaction;
            if (c.IsChild)
            {
                children++;
            }
            else if (c.IsSenior)
            {
                seniors++;
            }
            else
            {
                working++;
            }

            if (c.JobId != 0)
            {
                employed++;
                if (c.LastCommuteMinutes > 0)
                {
                    commuteSum += c.LastCommuteMinutes;
                    commuters++;
                }
            }
        }

        int resCap = 0, comJobs = 0, indJobs = 0, filled = 0;
        int resB = 0, comB = 0, indB = 0, serviceB = 0, abandoned = 0, construction = 0, burning = 0;
        int garbage = 0;
        long landfillStored = 0, landfillCapacity = 0;
        foreach (var b in sim.Buildings)
        {
            if (b.Abandoned)
            {
                abandoned++;
            }

            if (!b.IsComplete)
            {
                construction++;
            }

            if (b.IsBurning)
            {
                burning++;
            }

            garbage += b.Garbage;
            switch (b.Kind)
            {
                case BuildingKind.Residential:
                    resB++;
                    resCap += b.Capacity;
                    break;
                case BuildingKind.Commercial:
                    comB++;
                    comJobs += b.Capacity;
                    filled += b.Workers;
                    break;
                case BuildingKind.Industrial:
                    indB++;
                    indJobs += b.Capacity;
                    filled += b.Workers;
                    break;
                case BuildingKind.Landfill:
                    serviceB++;
                    landfillStored += b.Stored;
                    landfillCapacity += b.Spec.StorageCapacity;
                    break;
                default:
                    serviceB++;
                    break;
            }
        }

        s.Population = population;
        s.Children = children;
        s.WorkingAge = working;
        s.Seniors = seniors;
        s.Employed = employed;
        s.Unemployed = Math.Max(0, working - employed);
        s.AverageSatisfaction = population == 0 ? 60 : satisfactionSum / population;
        s.AverageCommuteMinutes = commuters == 0 ? 0 : (int)(commuteSum / commuters);
        s.ResidentialCapacity = resCap;
        s.CommercialJobs = comJobs;
        s.IndustrialJobs = indJobs;
        s.FilledJobs = filled;
        s.ResidentialBuildings = resB;
        s.CommercialBuildings = comB;
        s.IndustrialBuildings = indB;
        s.ServiceBuildings = serviceB;
        s.AbandonedBuildings = abandoned;
        s.UnderConstruction = construction;
        s.BurningBuildings = burning;
        s.UncollectedGarbage = garbage;
        s.LandfillUsedPercent = landfillCapacity == 0 ? 0 : (int)(landfillStored * 100 / landfillCapacity);
    }

    public static void RaiseDailyWarnings(Simulation sim)
    {
        var s = sim.Stats;
        if (s.UnpoweredBuildings > 0)
        {
            sim.AddEvent(EventSeverity.Warning, $"{s.UnpoweredBuildings} buildings have no electricity.");
        }

        if (s.UnwateredBuildings > 0)
        {
            sim.AddEvent(EventSeverity.Warning, $"{s.UnwateredBuildings} buildings have no water.");
        }

        if (s.UncollectedGarbage > 500)
        {
            sim.AddEvent(EventSeverity.Warning, $"{s.UncollectedGarbage} units of garbage are piling up.");
        }

        if (s.LandfillUsedPercent >= 90)
        {
            sim.AddEvent(EventSeverity.Warning, $"Landfills are {s.LandfillUsedPercent}% full.");
        }

        if (sim.Budget.Money < 0)
        {
            sim.AddEvent(EventSeverity.Critical, "The city is in debt. Construction is blocked until the budget recovers.");
        }

        if (sim.Traffic.Metrics.TravelTimeIndex >= 200)
        {
            int index = sim.Traffic.Metrics.TravelTimeIndex;
            sim.AddEvent(EventSeverity.Warning, $"Heavy congestion: trips take {index / 100}.{index % 100 / 10}x free-flow time.");
        }
    }
}
