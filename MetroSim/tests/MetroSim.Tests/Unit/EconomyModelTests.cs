using MetroSim.Core.Economy;
using MetroSim.Core.World;

namespace MetroSim.Tests.Unit;

public sealed class EconomyModelTests
{
    private static EconomyModel.DemandInputs Baseline() => new(
        Population: 1000, WorkingAge: 600, Employed: 580, ResidentialCapacity: 1100,
        CommercialJobs: 200, IndustrialJobs: 420, AverageSatisfaction: 60,
        ResidentialTax: 9, CommercialTax: 9, IndustrialTax: 9);

    [Theory]
    [InlineData(10_000, 9, 900)]
    [InlineData(10_099, 9, 908)]
    [InlineData(0, 29, 0)]
    [InlineData(12_345, 0, 0)]
    public void Tax_RoundsDownToWholeCents(long taxable, int rate, long expected) =>
        Assert.Equal(expected, EconomyModel.Tax(taxable, rate));

    [Fact]
    public void Revenue_FollowsPerWorkerAndPerCustomerRates()
    {
        Assert.Equal(10 * 1_500 + 20 * 150, EconomyModel.CommercialRevenue(10, 20));
        Assert.Equal(7 * 1_800, EconomyModel.IndustrialRevenue(7));
    }

    [Theory]
    [InlineData(9, 0)]
    [InlineData(5, 8)]
    [InlineData(0, 18)]
    [InlineData(12, -9)]
    [InlineData(29, -60)]
    public void TaxDemandEffect_RewardsLowAndPunishesHighRates(int rate, int expected) =>
        Assert.Equal(expected, EconomyModel.TaxDemandEffect(rate));

    [Fact]
    public void Demand_EmptyCity_WantsResidentsAndIndustry()
    {
        var (r, c, i) = EconomyModel.ComputeDemand(new(0, 0, 0, 0, 0, 0, 60, 9, 9, 9));
        Assert.True(r > 0);
        Assert.True(i > 0);
        Assert.True(c > 0);
    }

    [Fact]
    public void Demand_MoreOpenJobs_RaisesResidentialDemand()
    {
        var baseline = EconomyModel.ComputeDemand(Baseline());
        var moreJobs = EconomyModel.ComputeDemand(Baseline() with { IndustrialJobs = 900 });
        Assert.True(moreJobs.Residential > baseline.Residential);
    }

    [Fact]
    public void Demand_HigherTax_LowersThatZonesDemand()
    {
        var baseline = EconomyModel.ComputeDemand(Baseline());
        var taxed = EconomyModel.ComputeDemand(Baseline() with { ResidentialTax = 20, CommercialTax = 20, IndustrialTax = 20 });
        Assert.True(taxed.Residential < baseline.Residential);
        Assert.True(taxed.Commercial < baseline.Commercial);
        Assert.True(taxed.Industrial < baseline.Industrial);
    }

    [Fact]
    public void Demand_ManyVacancies_LowersResidentialDemand()
    {
        var baseline = EconomyModel.ComputeDemand(Baseline());
        var empty = EconomyModel.ComputeDemand(Baseline() with { ResidentialCapacity = 4000 });
        Assert.True(empty.Residential < baseline.Residential);
    }

    [Fact]
    public void Demand_SaturatedCommerce_TurnsCommercialDemandNegative()
    {
        var (_, c, _) = EconomyModel.ComputeDemand(Baseline() with { CommercialJobs = 2000 });
        Assert.True(c < 0);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(20, 2)]
    [InlineData(100, 6)]
    public void GrowthPerHour_ScalesWithDemandAndCaps(int demand, int expected) =>
        Assert.Equal(expected, EconomyModel.GrowthPerHour(demand));

    [Fact]
    public void Satisfaction_ServicesAndJobsRaiseIt()
    {
        var good = new EconomyModel.SatisfactionInputs(true, true, false, true, true, 0, 160, true, true, 0, 20, 9);
        var bad = new EconomyModel.SatisfactionInputs(false, false, true, false, false, 200, 0, true, false, 5, 0, 25);
        Assert.Equal(100, EconomyModel.Satisfaction(good));
        Assert.Equal(0, EconomyModel.Satisfaction(bad));
    }

    [Fact]
    public void Satisfaction_LongCommutePenalised()
    {
        var shortTrip = new EconomyModel.SatisfactionInputs(true, true, false, false, false, 0, 60, true, true, 0, 20, 9);
        var longTrip = shortTrip with { CommuteMinutes = 120 };
        Assert.Equal(15, EconomyModel.Satisfaction(shortTrip) - EconomyModel.Satisfaction(longTrip));
    }

    [Fact]
    public void Budget_SetTax_ClampsAndRejectsNoZone()
    {
        var budget = new Budget();
        budget.SetTax(ZoneType.Commercial, 50);
        Assert.Equal(Budget.MaxTax, budget.CommercialTax);
        budget.SetTax(ZoneType.Industrial, -3);
        Assert.Equal(0, budget.IndustrialTax);
        Assert.Throws<ArgumentOutOfRangeException>(() => budget.SetTax(ZoneType.None, 5));
    }

    [Fact]
    public void Budget_ChargeConstruction_RecordsInTodaysLedger()
    {
        var budget = new Budget();
        budget.ChargeConstruction(12_500);
        budget.ChargeConstruction(500);
        Assert.Equal(Budget.StartingMoney - 13_000, budget.Money);
        Assert.Equal(13_000, budget.Today.Construction);
        Assert.Equal(13_000, budget.Today.Expenses);
    }
}
