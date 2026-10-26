using MetroSim.Core.Engine;
using MetroSim.Persistence;

namespace MetroSim.Cli;

internal static class Persistence
{
    public static void Save(Simulation sim, string path) => SaveGameStore.Save(sim, path);

    public static Simulation Load(string path) => SaveGameStore.Load(path);

    public static bool Verify(string path)
    {
        try
        {
            var summary = SaveGameStore.ReadSummary(path);
            Console.WriteLine($"{summary.CityName}: format {summary.FormatVersion}, seed {summary.Seed}, " +
                $"{summary.MapWidth}x{summary.MapHeight}, day {summary.Tick / Simulation.TicksPerDay}, population {summary.Population}");
            var sim = SaveGameStore.Load(path);
            Console.WriteLine($"Integrity: OK (container, chunk checksums and state fingerprint {summary.StateHash[..16]}...)");
            var replay = ReplayVerifier.Replay(sim);
            Console.WriteLine($"Replay: {replay.CommandsReplayed} commands from seed to tick {sim.Tick} -> " +
                (replay.Matches ? "identical state" : $"MISMATCH ({replay.ReplayedHash[..16]}...)"));
            return replay.Matches;
        }
        catch (SaveGameException ex)
        {
            Console.Error.WriteLine($"Integrity: FAILED - {ex.Message}");
            return false;
        }
    }
}
