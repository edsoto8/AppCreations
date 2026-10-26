namespace MetroSim.Core.Buildings;

/// <summary>Static properties of a building type. Money values are cents.</summary>
public sealed record BuildingSpec
{
    public required BuildingKind Kind { get; init; }

    public required string Name { get; init; }

    public required ServiceCategory Category { get; init; }

    /// <summary>Footprint is Size x Size tiles.</summary>
    public int Size { get; init; } = 1;

    public long BuildCost { get; init; }

    public long UpkeepPerDay { get; init; }

    public int PowerOutput { get; init; }

    public int PowerUse { get; init; }

    public int WaterOutput { get; init; }

    public int WaterUse { get; init; }

    public int PollutionStrength { get; init; }

    public int PollutionRadius { get; init; }

    /// <summary>Service reach in road tiles from the building's access road.</summary>
    public int CoverageRange { get; init; }

    /// <summary>Garbage units processed per day.</summary>
    public int DailyCapacity { get; init; }

    /// <summary>Garbage units a landfill can hold before it is full.</summary>
    public int StorageCapacity { get; init; }

    /// <summary>Service vehicles (fire trucks).</summary>
    public int Vehicles { get; init; }

    /// <summary>Hours of construction before the building operates.</summary>
    public int ConstructionHours { get; init; } = 2;

    public string Description { get; init; } = "";
}

/// <summary>Per-level numbers for zoned buildings (index 0 = level 1).</summary>
public static class ZoneLevels
{
    public const int MaxLevel = 3;

    private static readonly int[] ResidentialCapacity = [8, 16, 30];
    private static readonly int[] CommercialJobs = [6, 12, 20];
    private static readonly int[] IndustrialJobs = [10, 18, 28];
    private static readonly int[] ResidentialPower = [4, 7, 11];
    private static readonly int[] CommercialPower = [6, 10, 15];
    private static readonly int[] IndustrialPower = [10, 16, 24];
    private static readonly int[] ResidentialWater = [4, 7, 12];
    private static readonly int[] CommercialWater = [3, 5, 8];
    private static readonly int[] IndustrialWater = [8, 12, 18];

    /// <summary>Land value required to grow into each level.</summary>
    public static readonly int[] LandValueForLevel = [0, 90, 140];

    /// <summary>Residents for residential buildings, jobs for commercial and industrial.</summary>
    public static int Capacity(BuildingKind kind, int level) => kind switch
    {
        BuildingKind.Residential => ResidentialCapacity[level - 1],
        BuildingKind.Commercial => CommercialJobs[level - 1],
        BuildingKind.Industrial => IndustrialJobs[level - 1],
        _ => 0,
    };

    public static int PowerUse(BuildingKind kind, int level) => kind switch
    {
        BuildingKind.Residential => ResidentialPower[level - 1],
        BuildingKind.Commercial => CommercialPower[level - 1],
        BuildingKind.Industrial => IndustrialPower[level - 1],
        _ => BuildingCatalog.Get(kind).PowerUse,
    };

    public static int WaterUse(BuildingKind kind, int level) => kind switch
    {
        BuildingKind.Residential => ResidentialWater[level - 1],
        BuildingKind.Commercial => CommercialWater[level - 1],
        BuildingKind.Industrial => IndustrialWater[level - 1],
        _ => BuildingCatalog.Get(kind).WaterUse,
    };
}
