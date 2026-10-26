using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Scenarios;

/// <summary>
/// A dense gridded city built directly (no growth, no money): mixed blocks (columns R R C I R I like the
/// demo city), level-3 buildings, citizens matched to jobs by the game's own rules. Gives benchmarks and
/// stress tests a known population on demand.
/// </summary>
public static class SyntheticCity
{
    public static Simulation Build(int size, int targetCitizens, ulong seed = 5)
    {
        var sim = Simulation.Create(new MapSettings
        {
            Width = size,
            Height = size,
            Seed = seed,
            WaterCoverage = 0,
            RockCoverage = 0,
            TreeCoverage = 0,
            Rivers = 0,
        });
        sim.Budget.Money = long.MaxValue / 4;
        const int pitch = 6;
        int lines = (size - 2) / pitch;
        for (int k = 0; k <= lines; k++)
        {
            var type = k % 4 == 2 ? RoadType.Avenue : RoadType.Street;
            sim.Execute(new BuildRoadCommand(1, 1 + k * pitch, 1 + lines * pitch, 1 + k * pitch, type));
            sim.Execute(new BuildRoadCommand(1 + k * pitch, 1, 1 + k * pitch, 1 + lines * pitch, type));
        }

        var homes = new List<Building>();
        var jobs = new List<Building>();
        for (int y = 2; y < 1 + lines * pitch; y++)
        {
            for (int x = 2; x < 1 + lines * pitch; x++)
            {
                if ((x - 1) % pitch == 0 || (y - 1) % pitch == 0 || sim.FindAccess(x, y, 1) < 0)
                {
                    continue;
                }

                var kind = ((x - 1) / pitch % 6) switch
                {
                    2 => BuildingKind.Commercial,
                    3 or 5 => BuildingKind.Industrial,
                    _ => BuildingKind.Residential,
                };
                var b = sim.Growth.CreateBuilding(kind, x, y);
                b.ConstructionHours = 0;
                b.Level = 3;
                (kind == BuildingKind.Residential ? homes : jobs).Add(b);
            }
        }

        sim.TouchBuildings();
        int created = 0;
        foreach (var home in homes)
        {
            while (home.Residents < home.Capacity && created < targetCitizens)
            {
                sim.CitizenSystem.AddCitizen(home, 20 + created % 40);
                created++;
            }
        }

        // The game's own job matching (nearest of sampled vacancies), so commutes are realistic.
        for (int round = 0; round < targetCitizens / 300 + 10; round++)
        {
            sim.CitizenSystem.MatchJobs();
        }

        sim.Step();
        return sim;
    }
}
