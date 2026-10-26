using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.Scenarios;
using MetroSim.Core.World;

namespace MetroSim.Cli;

/// <summary>
/// Reproducible performance measurements: tick rate and population scaling, routing cost, memory, and
/// a long organic-growth run. Prints a Markdown report (and writes it with --out).
/// </summary>
internal static class Benchmarks
{
    public static int Run(Options o)
    {
        bool quick = o.Flag("quick");
        var report = new StringBuilder();
        report.AppendLine("# MetroSim benchmark results");
        report.AppendLine();
        report.AppendLine($"- Date: {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC");
        report.AppendLine($"- Machine: {Environment.ProcessorCount} logical cores, {RuntimeInformation.OSDescription}, {RuntimeInformation.ProcessArchitecture}");
        report.AppendLine($"- Runtime: .NET {Environment.Version}, {(IsOptimized() ? "Release" : "Debug")} build, server GC off");
        report.AppendLine($"- Command: `metrosim bench{(quick ? " --quick" : "")}`");
        report.AppendLine();

        Section(report, "Population scaling (synthetic dense city, one full simulated day)", () => Scaling(quick));
        Section(report, "Routing (A* on the road grid)", () => Routing(quick));
        Section(report, "Organic growth (demo city with auto-mayor)", () => Growth(quick));

        string text = report.ToString();
        Console.WriteLine(text);
        if (o.String("out") is { } path)
        {
            File.WriteAllText(path, text);
            Console.WriteLine($"Wrote {path}");
        }

        return 0;
    }

    /// <summary>Runs the 20k synthetic city for one day; a fixed workload for profilers.</summary>
    public static int Profile(Options o)
    {
        int citizens = o.Int("citizens", 20_000);
        var sim = SyntheticCity.Build(SizeFor(citizens), citizens);
        if (o.String("weight") is not null)
        {
            sim.Pathfinder.HeuristicWeightPercent = o.Int("weight", 100);
        }

        var watch = Stopwatch.StartNew();
        sim.Run(Simulation.TicksPerDay);
        var m = sim.Traffic.Metrics;
        Console.WriteLine($"{citizens} citizens: {watch.Elapsed.TotalMilliseconds / Simulation.TicksPerDay:0.000} ms/tick, " +
            $"pathfinding {Seconds(sim.Pathfinder.ElapsedTicks):0.00}s of {watch.Elapsed.TotalSeconds:0.00}s, " +
            $"{sim.Pathfinder.Searches:N0} searches ({m.Reroutes:N0} reroutes), {sim.Pathfinder.NodesExpanded / Math.Max(1, sim.Pathfinder.Searches):N0} nodes/search; " +
            $"trips {m.TripsCompleted:N0}, peak TTI {sim.History.Samples.Max(h => h.TravelTimeIndex)}, " +
            $"avg commute {sim.Stats.AverageCommuteMinutes} min, peak vehicles {sim.History.Samples.Max(h => h.Vehicles):N0}");
        return 0;
    }

    private static void Section(StringBuilder report, string title, Func<string> body)
    {
        Console.Error.WriteLine($"running: {title}");
        report.AppendLine($"## {title}");
        report.AppendLine();
        report.AppendLine(body());
    }

    private static int SizeFor(int citizens) => citizens switch
    {
        <= 2_500 => 64,
        <= 5_000 => 88,
        <= 10_000 => 120,
        <= 20_000 => 160,
        _ => 224,
    };

    private static string Scaling(bool quick)
    {
        int[] sizes = quick ? [2_500, 10_000] : [2_500, 5_000, 10_000, 20_000, 40_000];
        var sb = new StringBuilder();
        sb.AppendLine("| Citizens | Map | Build ms | Memory (managed) | ms/tick mean | ms/tick p99 | ticks/s | Peak vehicles | Trips/day | Searches | Nodes/search | Pathfinding share | Peak TTI |");
        sb.AppendLine("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
        foreach (int citizens in sizes)
        {
            GC.Collect();
            long before = GC.GetTotalMemory(true);
            var build = Stopwatch.StartNew();
            int size = SizeFor(citizens);
            var sim = SyntheticCity.Build(size, citizens);
            build.Stop();
            long memory = GC.GetTotalMemory(true) - before;
            long searches0 = sim.Pathfinder.Searches;
            long nodes0 = sim.Pathfinder.NodesExpanded;
            long path0 = sim.Pathfinder.ElapsedTicks;
            long trips0 = sim.Traffic.Metrics.TripsCompleted;
            var times = new double[Simulation.TicksPerDay];
            int peak = 0;
            var total = Stopwatch.StartNew();
            for (int t = 0; t < Simulation.TicksPerDay; t++)
            {
                long start = Stopwatch.GetTimestamp();
                sim.Step();
                times[t] = (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;
                peak = Math.Max(peak, sim.Traffic.Vehicles.Count);
            }

            total.Stop();
            Array.Sort(times);
            double mean = total.Elapsed.TotalMilliseconds / Simulation.TicksPerDay;
            long searches = sim.Pathfinder.Searches - searches0;
            long nodes = sim.Pathfinder.NodesExpanded - nodes0;
            double pathShare = Seconds(sim.Pathfinder.ElapsedTicks - path0) / total.Elapsed.TotalSeconds;
            int peakTti = sim.History.Samples.Count == 0 ? 100 : sim.History.Samples.Max(h => h.TravelTimeIndex);
            sb.AppendLine($"| {sim.Citizens.Count:N0} | {size}x{size} | {build.ElapsedMilliseconds:N0} | {memory / 1024.0 / 1024.0:0.0} MB | " +
                $"{mean:0.000} | {times[(int)(times.Length * 0.99)]:0.000} | {1000 / mean:N0} | {peak:N0} | " +
                $"{sim.Traffic.Metrics.TripsCompleted - trips0:N0} | {searches:N0} | {(searches == 0 ? 0 : nodes / searches):N0} | " +
                $"{pathShare:P0} | {peakTti / 100.0:0.00} |");
            Console.Error.WriteLine($"  {citizens}: {mean:0.000} ms/tick");
        }

        return sb.ToString();
    }

    private sealed class FreeFlowCost : IRoadCostModel
    {
        public int MinimumEntryCost => 667;

        public int EntryCost(int tile, Direction travel) => 1000;
    }

    private static string Routing(bool quick)
    {
        var sb = new StringBuilder();
        sb.AppendLine("| Map | Road tiles | Cost model | Searches | µs/search mean | Nodes/search | Searches/s |");
        sb.AppendLine("|---:|---:|---|---:|---:|---:|---:|");
        foreach (int size in quick ? new[] { 128 } : new[] { 64, 128, 256 })
        {
            var sim = SyntheticCity.Build(size, 0);
            var roads = new List<int>();
            for (int t = 0; t < sim.Map.TileCount; t++)
            {
                if (sim.Map.Roads[t] != RoadType.None)
                {
                    roads.Add(t);
                }
            }

            foreach (var (name, model) in new (string, IRoadCostModel)[] { ("uniform", new FreeFlowCost()), ("live traffic", sim.Traffic) })
            {
                var rng = new Pcg32(9, 9);
                int n = quick ? 2_000 : 10_000;
                var pairs = new (int, int)[n];
                for (int i = 0; i < n; i++)
                {
                    pairs[i] = (roads[rng.Next(roads.Count)], roads[rng.Next(roads.Count)]);
                }

                long nodes0 = sim.Pathfinder.NodesExpanded;
                var watch = Stopwatch.StartNew();
                foreach (var (a, b) in pairs)
                {
                    sim.Pathfinder.FindPath(a, b, model, out _);
                }

                watch.Stop();
                long nodes = sim.Pathfinder.NodesExpanded - nodes0;
                sb.AppendLine($"| {size}x{size} | {roads.Count:N0} | {name} | {n:N0} | {watch.Elapsed.TotalMilliseconds * 1000 / n:0.0} | " +
                    $"{nodes / n:N0} | {n / watch.Elapsed.TotalSeconds:N0} |");
            }
        }

        return sb.ToString();
    }

    private static string Growth(bool quick)
    {
        int days = quick ? 20 : 90;
        var sim = Simulation.Create(new MapSettings { Seed = 42, Width = 192, Height = 192 });
        var plan = DemoCity.Build(sim, 12);
        var mayor = new AutoMayor(sim, plan);
        var sb = new StringBuilder();
        sb.AppendLine("| Day | Population | Buildings | Peak vehicles (day) | Peak TTI (day) | ms/tick (day mean) | Managed memory |");
        sb.AppendLine("|---:|---:|---:|---:|---:|---:|---:|");
        var watch = Stopwatch.StartNew();
        for (int day = 1; day <= days; day++)
        {
            var dayWatch = Stopwatch.StartNew();
            DemoCity.Run(sim, mayor, Simulation.TicksPerDay);
            dayWatch.Stop();
            if (day % (quick ? 5 : 15) == 0)
            {
                var last = sim.History.Samples.TakeLast(24).ToList();
                sb.AppendLine($"| {day} | {sim.Stats.Population:N0} | {sim.Buildings.Count:N0} | {last.Max(h => h.Vehicles):N0} | " +
                    $"{last.Max(h => h.TravelTimeIndex) / 100.0:0.00} | {dayWatch.Elapsed.TotalMilliseconds / Simulation.TicksPerDay:0.000} | " +
                    $"{GC.GetTotalMemory(false) / 1024.0 / 1024.0:0} MB |");
            }
        }

        watch.Stop();
        sb.AppendLine();
        sb.AppendLine($"{days} simulated days ({days * Simulation.TicksPerDay:N0} ticks) in {watch.Elapsed.TotalSeconds:0.0} s = " +
            $"{days * Simulation.TicksPerDay / watch.Elapsed.TotalSeconds:N0} ticks/s overall; pathfinding " +
            $"{Seconds(sim.Pathfinder.ElapsedTicks) / watch.Elapsed.TotalSeconds:P0} of the time " +
            $"({sim.Pathfinder.Searches:N0} searches, {sim.Pathfinder.NodesExpanded / Math.Max(1, sim.Pathfinder.Searches):N0} nodes each).");
        return sb.ToString();
    }

    private static double Seconds(long stopwatchTicks) => stopwatchTicks / (double)Stopwatch.Frequency;

    private static bool IsOptimized() =>
        typeof(Benchmarks).Assembly.GetCustomAttributes(typeof(DebuggableAttribute), false) is not [DebuggableAttribute { IsJITOptimizerDisabled: true }];
}
