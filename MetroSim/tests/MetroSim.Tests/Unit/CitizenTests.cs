using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Engine;
using MetroSim.Core.Traffic;
using MetroSim.Tests.Support;

namespace MetroSim.Tests.Unit;

public sealed class CitizenTests
{
    private static (Simulation Sim, Building Home, Building Work) Commute()
    {
        var sim = TestWorld.Flat(64);
        sim.Road(2, 10, 50, 10);
        var home = sim.Finished(BuildingKind.Residential, 3, 9);
        var work = sim.Finished(BuildingKind.Industrial, 45, 9);
        return (sim, home, work);
    }

    [Fact]
    public void Commuter_DrivesToWorkAtStartTime_AndHomeAfterShift()
    {
        var (sim, home, work) = Commute();
        var c = sim.Resident(home);
        sim.Employ(c, work, workStart: 8 * 60);
        sim.RunUntilMinute(8 * 60);
        Assert.Equal(CitizenState.ToWork, c.State);
        var car = sim.Traffic.Vehicles[c.VehicleId]!;
        Assert.Equal(VehicleKind.Car, car.Kind);
        Assert.Equal(c.Id, car.CitizenId);

        sim.RunUntilMinute(10 * 60);
        Assert.Equal(CitizenState.AtWork, c.State);
        Assert.InRange(c.LastCommuteMinutes, 40, 50);
        Assert.Equal(0, c.VehicleId);

        sim.RunUntilMinute(16 * 60 + 1);
        Assert.Equal(CitizenState.ToHome, c.State);
        sim.RunUntilMinute(18 * 60);
        Assert.Equal(CitizenState.AtHome, c.State);
    }

    [Fact]
    public void CommuteLongerThanShift_StillEndsWithTripHome()
    {
        var (sim, home, work) = Commute();
        var c = sim.Resident(home);
        sim.Employ(c, work, workStart: 8 * 60);
        sim.RunUntilMinute(8 * 60);
        Assert.Equal(CitizenState.ToWork, c.State);
        // Make the shift end before the 42-minute trip does: the citizen reaches work after it ended.
        c.ActivityEnd = sim.Tick + 30;
        while (c.State == CitizenState.ToWork)
        {
            sim.Step();
        }

        Assert.Equal(CitizenState.AtWork, c.State);
        sim.Step();
        Assert.Equal(CitizenState.ToHome, c.State);
    }

    [Fact]
    public void JobMatching_EmploysWorkingAgeAdultsOnlyInReach()
    {
        var (sim, home, work) = Commute();
        var adult = sim.Resident(home, 30);
        var child = sim.Resident(home, 8);
        var senior = sim.Resident(home, 70);
        var islandHome = sim.Finished(BuildingKind.Residential, 20, 30);
        var islander = sim.Resident(islandHome, 30);
        sim.CitizenSystem.MatchJobs();
        Assert.Equal(work.Id, adult.JobId);
        Assert.Equal(0, child.JobId);
        Assert.Equal(0, senior.JobId);
        Assert.Equal(0, islander.JobId);
        Assert.Equal(1, work.Workers);
        Assert.InRange(adult.WorkStart, 6 * 60, 10 * 60 - 1);
    }

    [Fact]
    public void JobMatching_NeverExceedsCapacity()
    {
        var (sim, home, work) = Commute();
        home.Level = 3;
        for (int i = 0; i < 20; i++)
        {
            sim.Resident(home, 30);
        }

        sim.CitizenSystem.MatchJobs();
        Assert.Equal(work.Capacity, work.Workers);
        Assert.Equal(work.Capacity, sim.Citizens.Count(c => c.JobId == work.Id));
    }

    [Fact]
    public void Migration_FillsVacantHomesWhenDemandIsPositive()
    {
        var (sim, home, _) = Commute();
        sim.CitizenSystem.MigrateIn(residentialDemand: 80);
        Assert.InRange(home.Residents, 1, home.Capacity);
        Assert.Equal(home.Residents, sim.Citizens.Count);
        int before = sim.Citizens.Count;
        sim.CitizenSystem.MigrateIn(residentialDemand: -10);
        Assert.Equal(before, sim.Citizens.Count);
    }

    [Fact]
    public void RemovingWorkplace_UnemploysWorkers()
    {
        var (sim, home, work) = Commute();
        var c = sim.Resident(home);
        sim.Employ(c, work);
        sim.Execute(new BulldozeCommand(45, 9, 45, 9));
        Assert.Equal(0, c.JobId);
        Assert.NotNull(sim.Citizens[c.Id]);
    }

    [Fact]
    public void Daily_UnhappyCitizensEventuallyMoveOut()
    {
        var (sim, home, _) = Commute();
        sim.Budget.ResidentialTax = 29;
        for (int i = 0; i < 6; i++)
        {
            sim.Resident(home, 30);
        }

        for (int day = 1; day <= 12; day++)
        {
            sim.CitizenSystem.Daily(day);
        }

        Assert.True(sim.Citizens.Count < 6);
        Assert.True(sim.Stats.TotalMovedOut > 0);
        Assert.Equal(sim.Citizens.Count, home.Residents);
    }

    [Fact]
    public void Daily_AgeingRetiresWorkers()
    {
        var (sim, home, work) = Commute();
        // A well-served home, so the citizen is content and stays for the whole year.
        home.Powered = home.Watered = home.CoveredByHealth = home.CoveredByFire = true;
        var c = sim.Resident(home, Citizen.RetirementAge - 1);
        sim.Employ(c, work);
        for (int day = 0; day < Simulation.DaysPerYear; day++)
        {
            sim.CitizenSystem.Daily(day);
        }

        var still = sim.Citizens[c.Id];
        Assert.NotNull(still);
        Assert.Equal(Citizen.RetirementAge, still!.Age);
        Assert.Equal(0, still.JobId);
        Assert.Equal(0, work.Workers);
    }
}
