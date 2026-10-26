using MetroSim.Core.World;

namespace MetroSim.Core.Economy;

/// <summary>One day of municipal accounts, in cents.</summary>
public sealed class DailyLedger
{
    public int Day { get; set; }

    public long ResidentialTax { get; set; }

    public long CommercialTax { get; set; }

    public long IndustrialTax { get; set; }

    public long RoadUpkeep { get; set; }

    public long PowerUpkeep { get; set; }

    public long WaterUpkeep { get; set; }

    public long GarbageUpkeep { get; set; }

    public long FireUpkeep { get; set; }

    public long HealthUpkeep { get; set; }

    /// <summary>Construction spending during the day (charged when built).</summary>
    public long Construction { get; set; }

    public long ClosingBalance { get; set; }

    public long Income => ResidentialTax + CommercialTax + IndustrialTax;

    public long Upkeep => RoadUpkeep + PowerUpkeep + WaterUpkeep + GarbageUpkeep + FireUpkeep + HealthUpkeep;

    public long Expenses => Upkeep + Construction;

    public long Net => Income - Expenses;

    public DailyLedger Clone() => (DailyLedger)MemberwiseClone();
}

/// <summary>Treasury, tax rates and the budget history.</summary>
public sealed class Budget
{
    public const int MinTax = 0;
    public const int MaxTax = 29;
    public const int DefaultTax = 9;
    public const long StartingMoney = 7_000_000;
    public const int HistoryDays = 400;

    public long Money { get; set; } = StartingMoney;

    public int ResidentialTax { get; set; } = DefaultTax;

    public int CommercialTax { get; set; } = DefaultTax;

    public int IndustrialTax { get; set; } = DefaultTax;

    /// <summary>The day in progress; construction is accumulated here as it happens.</summary>
    public DailyLedger Today { get; set; } = new();

    public List<DailyLedger> History { get; } = [];

    public int TaxFor(ZoneType zone) => zone switch
    {
        ZoneType.Residential => ResidentialTax,
        ZoneType.Commercial => CommercialTax,
        ZoneType.Industrial => IndustrialTax,
        _ => 0,
    };

    public void SetTax(ZoneType zone, int percent)
    {
        percent = Math.Clamp(percent, MinTax, MaxTax);
        switch (zone)
        {
            case ZoneType.Residential:
                ResidentialTax = percent;
                break;
            case ZoneType.Commercial:
                CommercialTax = percent;
                break;
            case ZoneType.Industrial:
                IndustrialTax = percent;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(zone));
        }
    }

    public bool CanAfford(long cost) => cost <= 0 || Money >= cost;

    public void ChargeConstruction(long cost)
    {
        Money -= cost;
        Today.Construction += cost;
    }
}
