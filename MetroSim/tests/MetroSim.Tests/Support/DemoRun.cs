using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Core.World;

namespace MetroSim.Tests.Support;

/// <summary>The scripted demo city, the standard integration scenario.</summary>
internal sealed class DemoRun
{
    public DemoRun(ulong seed = 42, int size = 96, int blocks = 4)
    {
        Sim = Simulation.Create(new MapSettings { Seed = seed, Width = size, Height = size });
        Plan = DemoCity.Build(Sim, blocks);
        Mayor = new AutoMayor(Sim, Plan);
    }

    public Simulation Sim { get; }

    public DemoCityPlan Plan { get; }

    public AutoMayor Mayor { get; }

    public DemoRun Days(int days)
    {
        DemoCity.Run(Sim, Mayor, days * Simulation.TicksPerDay);
        return this;
    }

    public DemoRun Ticks(int ticks)
    {
        DemoCity.Run(Sim, Mayor, ticks);
        return this;
    }
}
