using MetroSim.Core.World;

namespace MetroSim.Core.Buildings;

public enum BuildingKind : byte
{
    Residential = 0,
    Commercial = 1,
    Industrial = 2,
    CoalPlant = 3,
    WindTurbine = 4,
    WaterPump = 5,
    WaterTower = 6,
    Landfill = 7,
    Incinerator = 8,
    FireStation = 9,
    Clinic = 10,
}

public enum ServiceCategory : byte
{
    Zoned = 0,
    Power = 1,
    Water = 2,
    Garbage = 3,
    Fire = 4,
    Health = 5,
}

public static class BuildingKinds
{
    public static bool IsZoned(this BuildingKind kind) => kind <= BuildingKind.Industrial;

    public static ZoneType Zone(this BuildingKind kind) => kind switch
    {
        BuildingKind.Residential => ZoneType.Residential,
        BuildingKind.Commercial => ZoneType.Commercial,
        BuildingKind.Industrial => ZoneType.Industrial,
        _ => ZoneType.None,
    };

    public static BuildingKind ForZone(ZoneType zone) => zone switch
    {
        ZoneType.Residential => BuildingKind.Residential,
        ZoneType.Commercial => BuildingKind.Commercial,
        ZoneType.Industrial => BuildingKind.Industrial,
        _ => throw new ArgumentOutOfRangeException(nameof(zone)),
    };
}
