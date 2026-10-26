using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Buildings;

public sealed class Building : IEntity
{
    public int Id { get; set; }

    public BuildingKind Kind { get; set; }

    /// <summary>Top-left tile.</summary>
    public int X { get; set; }

    public int Y { get; set; }

    public int Size { get; set; } = 1;

    public int Level { get; set; } = 1;

    /// <summary>Road tile index used to arrive and leave, or -1 without road access.</summary>
    public int AccessTile { get; set; } = -1;

    /// <summary>Hours of construction left; 0 means operating.</summary>
    public int ConstructionHours { get; set; }

    public bool Powered { get; set; }

    public bool Watered { get; set; }

    public bool CoveredByFire { get; set; }

    public bool CoveredByHealth { get; set; }

    public bool CoveredByGarbage { get; set; }

    /// <summary>Uncollected garbage units.</summary>
    public int Garbage { get; set; }

    /// <summary>Landfill fill level.</summary>
    public int Stored { get; set; }

    public int Residents { get; set; }

    public int Workers { get; set; }

    public int CustomersToday { get; set; }

    public int CustomersYesterday { get; set; }

    public int DaysUnpowered { get; set; }

    public int DaysNoWater { get; set; }

    public int DaysNoAccess { get; set; }

    public int DaysGarbage { get; set; }

    public int DaysNoWorkers { get; set; }

    /// <summary>Consecutive days with every condition for levelling up.</summary>
    public int GoodDays { get; set; }

    public bool Abandoned { get; set; }

    public int AbandonedDays { get; set; }

    /// <summary>0 when not burning; otherwise damage 1..100.</summary>
    public int FireDamage { get; set; }

    /// <summary>Fire truck assigned to this fire, 0 when none.</summary>
    public int FireTruckId { get; set; }

    /// <summary>Fire station whose truck is fighting this fire.</summary>
    public int FireStationId { get; set; }

    /// <summary>Ticks of hose work left once a truck is on site.</summary>
    public int ExtinguishTicks { get; set; }

    /// <summary>Fire trucks currently away from this station.</summary>
    public int TrucksOut { get; set; }

    /// <summary>Power produced in the last allocation round (power plants only).</summary>
    public int PowerProduced { get; set; }

    public BuildingSpec Spec => BuildingCatalog.Get(Kind);

    public bool IsComplete => ConstructionHours == 0;

    public bool IsOperating => ConstructionHours == 0 && !Abandoned;

    public bool IsBurning => FireDamage > 0;

    public ZoneType Zone => Kind.Zone();

    /// <summary>Residents (residential) or jobs (commercial, industrial) at the current level.</summary>
    public int Capacity => Kind.IsZoned() && IsOperating ? ZoneLevels.Capacity(Kind, Level) : 0;

    public int PowerUse => IsComplete ? ZoneLevels.PowerUse(Kind, Level) : 0;

    public int WaterUse => IsComplete ? ZoneLevels.WaterUse(Kind, Level) : 0;

    public int CenterTile(CityMap map) => map.Index(X + Size / 2, Y + Size / 2);

    public bool Contains(int x, int y) => x >= X && y >= Y && x < X + Size && y < Y + Size;
}
