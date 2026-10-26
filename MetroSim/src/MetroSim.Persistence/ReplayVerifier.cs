using MetroSim.Core.Engine;
using MetroSim.Core.Serialization;
using MetroSim.Core.World;

namespace MetroSim.Persistence;

public sealed record ReplayResult(bool Matches, string ExpectedHash, string ReplayedHash, int CommandsReplayed, int CommandsFailed);

/// <summary>
/// Rebuilds a city from its seed and command log and compares it with a saved or live state. Proves
/// that the simulation is deterministic end to end.
/// </summary>
public static class ReplayVerifier
{
    public static ReplayResult Replay(MapSettings settings, IReadOnlyList<LoggedCommand> log, long targetTick, string expectedHash)
    {
        var sim = Simulation.Create(settings);
        int next = 0;
        int failed = 0;
        while (true)
        {
            while (next < log.Count && log[next].Tick == sim.Tick)
            {
                if (!sim.Execute(log[next].Command).Success)
                {
                    failed++;
                }

                next++;
            }

            if (sim.Tick >= targetTick)
            {
                break;
            }

            sim.Step();
        }

        string hash = SimulationSerializer.ComputeHash(sim);
        return new ReplayResult(string.Equals(hash, expectedHash, StringComparison.Ordinal), expectedHash, hash, next, failed);
    }

    public static ReplayResult Replay(Simulation recorded) =>
        Replay(recorded.Settings, recorded.CommandLog, recorded.Tick, recorded.ComputeStateHash());
}
