namespace MetroSim.Core.Economy;

/// <summary>
/// Pure, deterministic economic formulas (integers only). Kept separate from the systems that call them
/// so they can be unit-tested directly.
/// </summary>
public static class EconomyModel
{
    /// <summary>Daily taxable income of one employed resident, in cents, by home level.</summary>
    public static readonly long[] ResidentWagePerDay = [2_500, 3_500, 5_000];

    public const long CommercialRevenuePerWorker = 1_500;
    public const long CommercialRevenuePerCustomer = 150;
    public const long IndustrialRevenuePerWorker = 1_800;

    /// <summary>Tax on an amount at a percentage rate, rounded down to whole cents.</summary>
    public static long Tax(long taxableCents, int ratePercent) => taxableCents * ratePercent / 100;

    public static long CommercialRevenue(int workers, int customers) =>
        workers * CommercialRevenuePerWorker + customers * CommercialRevenuePerCustomer;

    public static long IndustrialRevenue(int workers) => workers * IndustrialRevenuePerWorker;

    /// <summary>Demand change caused by a tax rate: +2 per point below 9%, -3 per point above.</summary>
    public static int TaxDemandEffect(int ratePercent) =>
        ratePercent <= Budget.DefaultTax ? (Budget.DefaultTax - ratePercent) * 2 : -(ratePercent - Budget.DefaultTax) * 3;

    /// <summary>Inputs to <see cref="ComputeDemand"/>.</summary>
    public readonly record struct DemandInputs(
        int Population,
        int WorkingAge,
        int Employed,
        int ResidentialCapacity,
        int CommercialJobs,
        int IndustrialJobs,
        int AverageSatisfaction,
        int ResidentialTax,
        int CommercialTax,
        int IndustrialTax);

    /// <summary>
    /// Residential/commercial/industrial demand in -100..100. Open jobs and happy citizens attract
    /// residents; vacancies and unemployment repel them. Commercial demand tracks population; industrial
    /// demand fills the remaining jobs needed for about 110% of the workforce, plus spare workers.
    /// </summary>
    public static (int Residential, int Commercial, int Industrial) ComputeDemand(DemandInputs d)
    {
        int jobs = d.CommercialJobs + d.IndustrialJobs;
        int workforce = Math.Max(d.WorkingAge, 50);
        int openJobs = Math.Max(0, jobs - d.Employed);
        int unemployed = Math.Max(0, d.WorkingAge - d.Employed);
        int vacancies = Math.Max(0, d.ResidentialCapacity - d.Population);

        int residential = 35
            + 60 * Math.Min(openJobs, workforce) / workforce
            - 60 * unemployed / workforce
            - 50 * vacancies / Math.Max(d.ResidentialCapacity, 60)
            + (d.AverageSatisfaction - 50) / 2
            + TaxDemandEffect(d.ResidentialTax);

        int commercialTarget = d.Population * 20 / 100;
        int commercial = 10
            + 100 * (commercialTarget - d.CommercialJobs) / Math.Max(commercialTarget, 30)
            + TaxDemandEffect(d.CommercialTax);

        // Total jobs settle near 110% of the workforce, so there is always some pull for new residents.
        int industrialTarget = Math.Max(40, d.WorkingAge * 110 / 100 - d.CommercialJobs);
        int industrial = 100 * (industrialTarget - d.IndustrialJobs) / Math.Max(industrialTarget, 30)
            + 40 * unemployed / workforce
            + TaxDemandEffect(d.IndustrialTax);

        return (Math.Clamp(residential, -100, 100), Math.Clamp(commercial, -100, 100), Math.Clamp(industrial, -100, 100));
    }

    /// <summary>Buildings to spawn this hour for a zone's demand.</summary>
    public static int GrowthPerHour(int demand) => demand <= 0 ? 0 : Math.Min(6, 1 + demand / 20);

    /// <summary>Households moving in per hour for a residential demand.</summary>
    public static int HouseholdsPerHour(int demand) => demand <= 0 ? 0 : Math.Min(8, 1 + demand / 15);

    /// <summary>
    /// Daily satisfaction 0..100 of a citizen from the conditions at home and work.
    /// </summary>
    public readonly record struct SatisfactionInputs(
        bool Powered,
        bool Watered,
        bool GarbageProblem,
        bool HealthCoverage,
        bool FireCoverage,
        int Pollution,
        int LandValue,
        bool IsWorkingAge,
        bool Employed,
        int DaysUnemployed,
        int CommuteMinutes,
        int ResidentialTax);

    public static int Satisfaction(SatisfactionInputs s)
    {
        int value = 50;
        value += s.Powered ? 10 : -20;
        value += s.Watered ? 10 : -20;
        value -= s.GarbageProblem ? 15 : 0;
        value += s.HealthCoverage ? 8 : 0;
        value += s.FireCoverage ? 5 : 0;
        value -= s.Pollution / 8;
        value += Math.Clamp((s.LandValue - 60) / 10, -5, 10);
        if (s.IsWorkingAge)
        {
            if (s.Employed)
            {
                value += 12 - Math.Clamp((s.CommuteMinutes - 45) / 5, 0, 15);
            }
            else if (s.DaysUnemployed > 1)
            {
                value -= 15;
            }
        }

        value -= (s.ResidentialTax - Budget.DefaultTax) * 2;
        return Math.Clamp(value, 0, 100);
    }
}
