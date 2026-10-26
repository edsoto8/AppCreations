using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.Roads;

namespace MetroSim.Core.Economy;

/// <summary>Daily settlement: taxes in, upkeep out, ledger recorded.</summary>
internal sealed class EconomySystem
{
    private readonly Simulation _sim;

    public EconomySystem(Simulation sim) => _sim = sim;

    public void SettleDay(int day)
    {
        var budget = _sim.Budget;
        var ledger = budget.Today;
        ledger.Day = day;

        var wagesByLevel = new long[ZoneLevels.MaxLevel];
        foreach (var c in _sim.Citizens)
        {
            if (c.JobId != 0 && _sim.Buildings[c.HomeId] is { } home)
            {
                wagesByLevel[home.Level - 1] += EconomyModel.ResidentWagePerDay[home.Level - 1];
            }
        }

        long wages = 0;
        foreach (long w in wagesByLevel)
        {
            wages += w;
        }

        long commercialRevenue = 0, industrialRevenue = 0;
        long power = 0, water = 0, garbage = 0, fire = 0, health = 0;
        foreach (var b in _sim.Buildings)
        {
            switch (b.Kind)
            {
                case BuildingKind.Commercial when b.IsOperating:
                    commercialRevenue += EconomyModel.CommercialRevenue(b.Workers, b.CustomersToday);
                    break;
                case BuildingKind.Industrial when b.IsOperating:
                    industrialRevenue += EconomyModel.IndustrialRevenue(b.Workers);
                    break;
            }

            long upkeep = b.Spec.UpkeepPerDay;
            switch (b.Spec.Category)
            {
                case ServiceCategory.Power: power += upkeep; break;
                case ServiceCategory.Water: water += upkeep; break;
                case ServiceCategory.Garbage: garbage += upkeep; break;
                case ServiceCategory.Fire: fire += upkeep; break;
                case ServiceCategory.Health: health += upkeep; break;
            }

            b.CustomersYesterday = b.CustomersToday;
            b.CustomersToday = 0;
        }

        var map = _sim.Map;
        long roads = 0;
        int powerLines = 0;
        for (int t = 0; t < map.TileCount; t++)
        {
            roads += RoadSpecs.UpkeepPerTilePerDay(map.Roads[t]);
            if (map.PowerLines[t])
            {
                powerLines++;
            }
        }

        ledger.ResidentialTax = EconomyModel.Tax(wages, budget.ResidentialTax);
        ledger.CommercialTax = EconomyModel.Tax(commercialRevenue, budget.CommercialTax);
        ledger.IndustrialTax = EconomyModel.Tax(industrialRevenue, budget.IndustrialTax);
        ledger.RoadUpkeep = roads + powerLines * RoadSpecs.PowerLineUpkeepPerTilePerDay;
        ledger.PowerUpkeep = power;
        ledger.WaterUpkeep = water;
        ledger.GarbageUpkeep = garbage;
        ledger.FireUpkeep = fire;
        ledger.HealthUpkeep = health;

        budget.Money += ledger.Income - ledger.Upkeep;
        ledger.ClosingBalance = budget.Money;
        budget.History.Add(ledger);
        if (budget.History.Count > Budget.HistoryDays)
        {
            budget.History.RemoveAt(0);
        }

        budget.Today = new DailyLedger { Day = day + 1 };
    }
}
