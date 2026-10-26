using MetroSim.Core.Engine;

namespace MetroSim.Core.Citizens;

public enum CitizenState : byte
{
    AtHome = 0,
    ToWork = 1,
    AtWork = 2,
    ToHome = 3,
    ToShop = 4,
    AtShop = 5,
}

public sealed class Citizen : IEntity
{
    public const int AdultAge = 18;
    public const int RetirementAge = 65;
    public const int WorkMinutes = 8 * 60;

    public int Id { get; set; }

    public int HomeId { get; set; }

    /// <summary>Workplace building id, 0 when unemployed.</summary>
    public int JobId { get; set; }

    public int Age { get; set; }

    public CitizenState State { get; set; }

    /// <summary>Minute of day the citizen leaves for work.</summary>
    public int WorkStart { get; set; }

    /// <summary>Minute of day of today's shopping trip, -1 for none.</summary>
    public int ShopMinute { get; set; } = -1;

    public int ShopId { get; set; }

    /// <summary>Tick at which the current shift or shop visit ends.</summary>
    public long ActivityEnd { get; set; }

    /// <summary>Vehicle or pedestrian id while travelling, else 0.</summary>
    public int VehicleId { get; set; }

    public int Satisfaction { get; set; } = 60;

    public int DaysUnemployed { get; set; }

    public int UnhappyDays { get; set; }

    public int LastCommuteMinutes { get; set; }

    public int FailedCommutes { get; set; }

    public bool IsChild => Age < AdultAge;

    public bool IsWorkingAge => Age >= AdultAge && Age < RetirementAge;

    public bool IsSenior => Age >= RetirementAge;

    public bool IsTravelling => State is CitizenState.ToWork or CitizenState.ToHome or CitizenState.ToShop;
}
