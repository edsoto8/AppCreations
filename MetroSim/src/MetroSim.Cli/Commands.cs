using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Core.World;

namespace MetroSim.Cli;

internal static class Commands
{
    private const string Usage = """
        metrosim <command> [options]

          demo     [--seed N] [--size N] [--blocks N] [--days N] [--save FILE]
                   Lay out the scripted demo city and run it, printing a daily report.
          new      --out FILE [--seed N] [--size N]
                   Generate an empty map and save it.
          run      --load FILE [--days N] [--save FILE]
                   Continue a saved city headlessly.
          verify   FILE
                   Check a save's integrity and replay its command log from the seed.
          bench    [--out FILE] [--quick]
                   Measure tick rate, routing, memory and population scaling.
        """;

    public static int Run(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            Console.WriteLine(Usage);
            return 0;
        }

        var options = Options.Parse(args.Skip(1).ToArray());
        return args[0] switch
        {
            "demo" => Demo(options),
            "new" => New(options),
            "run" => RunSaved(options),
            "verify" => Verify(options),
            "bench" => Benchmarks.Run(options),
            "profile" => Benchmarks.Profile(options),
            _ => throw new ArgumentException($"Unknown command '{args[0]}'.\n{Usage}"),
        };
    }

    private static int Demo(Options o)
    {
        var settings = new MapSettings { Seed = o.ULong("seed", 42), Width = o.Int("size", 128), Height = o.Int("size", 128) };
        var sim = Simulation.Create(settings);
        if (o.String("weight") is not null)
        {
            sim.Pathfinder.HeuristicWeightPercent = o.Int("weight", 100);
        }

        var plan = DemoCity.Build(sim, o.Int("blocks", 6));
        var mayor = new AutoMayor(sim, plan);
        Console.WriteLine($"Demo city: seed {settings.Seed}, map {settings.Width}x{settings.Height}, {plan.Blocks}x{plan.Blocks} blocks at ({plan.OriginX},{plan.OriginY}).");
        Report.PrintHeader();
        int days = o.Int("days", 10);
        for (int d = 0; d < days; d++)
        {
            DemoCity.Run(sim, mayor, Simulation.TicksPerDay);
            Report.PrintDay(sim);
        }

        Report.PrintSummary(sim);
        SaveIfRequested(sim, o);
        return 0;
    }

    private static int New(Options o)
    {
        string path = o.Require("out");
        var settings = new MapSettings { Seed = o.ULong("seed", 1), Width = o.Int("size", 128), Height = o.Int("size", 128) };
        var sim = Simulation.Create(settings);
        Persistence.Save(sim, path);
        Console.WriteLine($"Generated {settings.Width}x{settings.Height} map with seed {settings.Seed} -> {path}");
        return 0;
    }

    private static int RunSaved(Options o)
    {
        var sim = Persistence.Load(o.Require("load"));
        Console.WriteLine($"Loaded day {sim.Day}, population {sim.Stats.Population}.");
        Report.PrintHeader();
        int days = o.Int("days", 5);
        for (int d = 0; d < days; d++)
        {
            sim.RunDays(1);
            Report.PrintDay(sim);
        }

        Report.PrintSummary(sim);
        SaveIfRequested(sim, o);
        return 0;
    }

    private static int Verify(Options o)
    {
        string path = o.Positional(0) ?? o.Require("file");
        return Persistence.Verify(path) ? 0 : 1;
    }

    private static void SaveIfRequested(Simulation sim, Options o)
    {
        if (o.String("save") is { } path)
        {
            Persistence.Save(sim, path);
            Console.WriteLine($"Saved to {path}");
        }
    }
}

internal sealed class Options
{
    private readonly Dictionary<string, string> _named = new(StringComparer.Ordinal);
    private readonly List<string> _positional = [];

    public static Options Parse(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i].StartsWith("--", StringComparison.Ordinal))
            {
                string key = args[i][2..];
                bool hasValue = i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal);
                o._named[key] = hasValue ? args[++i] : "true";
            }
            else
            {
                o._positional.Add(args[i]);
            }
        }

        return o;
    }

    public string? String(string key) => _named.TryGetValue(key, out var v) ? v : null;

    public bool Flag(string key) => _named.ContainsKey(key);

    public string Require(string key) => String(key) ?? throw new ArgumentException($"--{key} is required.");

    public string? Positional(int index) => index < _positional.Count ? _positional[index] : null;

    public int Int(string key, int fallback) =>
        String(key) is { } v ? int.TryParse(v, out int n) ? n : throw new ArgumentException($"--{key} must be a number.") : fallback;

    public ulong ULong(string key, ulong fallback) =>
        String(key) is { } v ? ulong.TryParse(v, out ulong n) ? n : throw new ArgumentException($"--{key} must be a number.") : fallback;
}
