using MetroSim.Core.World;

namespace MetroSim.Core.Roads;

/// <summary>Road numbers. Money in cents, speed in milli-tiles per tick.</summary>
public static class RoadSpecs
{
    public const int MilliTile = 1000;

    public static long BuildCostPerTile(RoadType type) => type switch
    {
        RoadType.Street => 2_500,
        RoadType.Avenue => 6_000,
        _ => 0,
    };

    public static long UpkeepPerTilePerDay(RoadType type) => type switch
    {
        RoadType.Street => 25,
        RoadType.Avenue => 70,
        _ => 0,
    };

    /// <summary>Bridges over water cost 4x, roads over rock 2x.</summary>
    public static int TerrainCostMultiplier(TerrainType terrain) => terrain switch
    {
        TerrainType.Water => 4,
        TerrainType.Rock => 2,
        _ => 1,
    };

    public static int FreeFlowSpeed(RoadType type) => type switch
    {
        RoadType.Avenue => 1_500,
        _ => 1_000,
    };

    /// <summary>Vehicles one directional lane-tile holds before it is full.</summary>
    public static int LaneCapacity(RoadType type) => type switch
    {
        RoadType.Avenue => 5,
        _ => 3,
    };

    /// <summary>Vehicles an intersection tile admits per tick (acts like traffic signals).</summary>
    public static int IntersectionThroughput(RoadType type) => type switch
    {
        RoadType.Avenue => 6,
        _ => 4,
    };

    public const long PowerLineCostPerTile = 800;
    public const long PowerLineUpkeepPerTilePerDay = 10;
    public const long BulldozeRoadCostPerTile = 500;
}
