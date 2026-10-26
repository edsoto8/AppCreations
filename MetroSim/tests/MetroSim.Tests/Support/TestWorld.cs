using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Tests.Support;

/// <summary>Small deterministic worlds for tests.</summary>
internal static class TestWorld
{
    /// <summary>All-grass map: no water, rock, rivers or trees.</summary>
    public static Simulation Flat(int size = 48, ulong seed = 1) => Simulation.Create(new MapSettings
    {
        Width = size,
        Height = size,
        Seed = seed,
        WaterCoverage = 0,
        RockCoverage = 0,
        TreeCoverage = 0,
        Rivers = 0,
    });

    public static CommandResult Road(this Simulation sim, int x0, int y0, int x1, int y1, RoadType type = RoadType.Street)
    {
        var result = sim.Execute(new BuildRoadCommand(x0, y0, x1, y1, type));
        Assert.True(result.Success, result.Message);
        return result;
    }

    /// <summary>Creates a finished building directly (bypassing growth and money).</summary>
    public static Building Finished(this Simulation sim, BuildingKind kind, int x, int y)
    {
        var b = sim.Growth.CreateBuilding(kind, x, y);
        b.ConstructionHours = 0;
        sim.TouchBuildings();
        return b;
    }

    public static Citizen Resident(this Simulation sim, Building home, int age = 30) => sim.CitizenSystem.AddCitizen(home, age);

    public static void Employ(this Simulation sim, Citizen c, Building job, int workStart = 8 * 60)
    {
        c.JobId = job.Id;
        c.WorkStart = workStart;
        job.Workers++;
    }

    /// <summary>Runs until the clock reads the given minute of day (at least one tick).</summary>
    public static void RunUntilMinute(this Simulation sim, int minuteOfDay)
    {
        do
        {
            sim.Step();
        }
        while (sim.MinuteOfDay != minuteOfDay);
    }

    public static void RunHours(this Simulation sim, int hours) => sim.Run(hours * Simulation.TicksPerHour);

    public static string TempPath(string name) =>
        Path.Combine(Path.GetTempPath(), "metrosim-tests", Guid.NewGuid().ToString("N"), name);
}
