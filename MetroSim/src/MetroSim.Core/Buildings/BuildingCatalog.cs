namespace MetroSim.Core.Buildings;

/// <summary>All building types. Money in cents.</summary>
public static class BuildingCatalog
{
    private static readonly BuildingSpec[] Specs =
    [
        new() { Kind = BuildingKind.Residential, Name = "Residential", Category = ServiceCategory.Zoned, ConstructionHours = 3 },
        new() { Kind = BuildingKind.Commercial, Name = "Commercial", Category = ServiceCategory.Zoned, ConstructionHours = 3 },
        new() { Kind = BuildingKind.Industrial, Name = "Industrial", Category = ServiceCategory.Zoned, ConstructionHours = 3, PollutionStrength = 50, PollutionRadius = 4 },
        new()
        {
            Kind = BuildingKind.CoalPlant, Name = "Coal Power Plant", Category = ServiceCategory.Power, Size = 3,
            BuildCost = 2_000_000, UpkeepPerDay = 15_000, PowerOutput = 2_000, WaterUse = 20,
            PollutionStrength = 160, PollutionRadius = 9, ConstructionHours = 6,
            Description = "Large, cheap power. Heavy pollution.",
        },
        new()
        {
            Kind = BuildingKind.WindTurbine, Name = "Wind Turbine", Category = ServiceCategory.Power, Size = 1,
            BuildCost = 300_000, UpkeepPerDay = 2_500, PowerOutput = 120, ConstructionHours = 2,
            Description = "Clean power. Output rises with elevation.",
        },
        new()
        {
            Kind = BuildingKind.WaterPump, Name = "Water Pump", Category = ServiceCategory.Water, Size = 2,
            BuildCost = 500_000, UpkeepPerDay = 8_000, WaterOutput = 1_500, PowerUse = 30, ConstructionHours = 3,
            Description = "Must touch water. Feeds its road network.",
        },
        new()
        {
            Kind = BuildingKind.WaterTower, Name = "Water Tower", Category = ServiceCategory.Water, Size = 1,
            BuildCost = 250_000, UpkeepPerDay = 5_000, WaterOutput = 300, PowerUse = 10, ConstructionHours = 2,
            Description = "Small groundwater supply. Builds anywhere.",
        },
        new()
        {
            Kind = BuildingKind.Landfill, Name = "Landfill", Category = ServiceCategory.Garbage, Size = 3,
            BuildCost = 600_000, UpkeepPerDay = 10_000, DailyCapacity = 1_500, StorageCapacity = 60_000,
            CoverageRange = 40, PollutionStrength = 40, PollutionRadius = 4, ConstructionHours = 3,
            Description = "Collects garbage until it is full.",
        },
        new()
        {
            Kind = BuildingKind.Incinerator, Name = "Incinerator", Category = ServiceCategory.Garbage, Size = 2,
            BuildCost = 1_500_000, UpkeepPerDay = 25_000, DailyCapacity = 3_000, PowerUse = 60,
            CoverageRange = 50, PollutionStrength = 90, PollutionRadius = 6, ConstructionHours = 4,
            Description = "Burns garbage without filling up. Needs power.",
        },
        new()
        {
            Kind = BuildingKind.FireStation, Name = "Fire Station", Category = ServiceCategory.Fire, Size = 2,
            BuildCost = 800_000, UpkeepPerDay = 15_000, CoverageRange = 30, Vehicles = 3, PowerUse = 15, WaterUse = 10,
            ConstructionHours = 3, Description = "Prevents and fights fires. Trucks drive through traffic.",
        },
        new()
        {
            Kind = BuildingKind.Clinic, Name = "Clinic", Category = ServiceCategory.Health, Size = 2,
            BuildCost = 900_000, UpkeepPerDay = 16_000, CoverageRange = 30, PowerUse = 20, WaterUse = 15,
            ConstructionHours = 3, Description = "Keeps residents healthy and happier.",
        },
    ];

    public static IReadOnlyList<BuildingSpec> All => Specs;

    public static BuildingSpec Get(BuildingKind kind) => Specs[(int)kind];
}
