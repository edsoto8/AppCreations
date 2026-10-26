namespace MetroSim.Core.Engine;

/// <summary>City-wide numbers, refreshed hourly (utilities every 10 ticks). Saved with the game.</summary>
public sealed class CityStats
{
    public int Population { get; set; }

    public int Children { get; set; }

    public int WorkingAge { get; set; }

    public int Seniors { get; set; }

    public int Employed { get; set; }

    public int Unemployed { get; set; }

    public int CommercialJobs { get; set; }

    public int IndustrialJobs { get; set; }

    public int FilledJobs { get; set; }

    public int ResidentialCapacity { get; set; }

    public int ResidentialBuildings { get; set; }

    public int CommercialBuildings { get; set; }

    public int IndustrialBuildings { get; set; }

    public int ServiceBuildings { get; set; }

    public int AbandonedBuildings { get; set; }

    public int UnderConstruction { get; set; }

    public int BurningBuildings { get; set; }

    public int AverageSatisfaction { get; set; } = 60;

    public int AverageCommuteMinutes { get; set; }

    public int PowerProduction { get; set; }

    public int PowerDemand { get; set; }

    public int PowerSupplied { get; set; }

    public int UnpoweredBuildings { get; set; }

    public int WaterCapacity { get; set; }

    public int WaterDemand { get; set; }

    public int WaterSupplied { get; set; }

    public int UnwateredBuildings { get; set; }

    public int UncollectedGarbage { get; set; }

    public int GarbageProducedPerDay { get; set; }

    public int GarbageCapacityPerDay { get; set; }

    public int LandfillUsedPercent { get; set; }

    public long TotalBirths { get; set; }

    public long TotalDeaths { get; set; }

    public long TotalMovedIn { get; set; }

    public long TotalMovedOut { get; set; }

    public long BuildingsBurnedDown { get; set; }

    public long FiresExtinguished { get; set; }

    public int Jobs => CommercialJobs + IndustrialJobs;

    public int UnemploymentPercent => WorkingAge == 0 ? 0 : Unemployed * 100 / WorkingAge;
}

/// <summary>Hourly sample for dashboard charts.</summary>
public readonly record struct HourSample(
    long Tick,
    int Population,
    long Money,
    int Vehicles,
    int TravelTimeIndex,
    int CarTripsLastHour,
    int Employed,
    int Jobs,
    int Satisfaction);

public sealed class StatsHistory
{
    public const int Capacity = 24 * 14;

    private readonly List<HourSample> _samples = [];

    public IReadOnlyList<HourSample> Samples => _samples;

    public void Add(HourSample sample)
    {
        _samples.Add(sample);
        if (_samples.Count > Capacity)
        {
            _samples.RemoveAt(0);
        }
    }

    internal void Restore(IEnumerable<HourSample> samples)
    {
        _samples.Clear();
        _samples.AddRange(samples);
    }
}

/// <summary>Zone demand in -100..100, recomputed hourly.</summary>
public sealed class ZoneDemand
{
    public int Residential { get; set; }

    public int Commercial { get; set; }

    public int Industrial { get; set; }
}
