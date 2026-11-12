using System.IO.Enumeration;
using System.Text;
using BenchmarkDotNet.Reports;
using BenchmarkDotNet.Running;
using DotNet11Lab.Benchmarks;
using DotNet11Lab.Benchmarks.Suites;
using DotNet11Lab.Core.Labs.Performance;

// dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- [lab options] [BenchmarkDotNet options]
var options = LabOptions.Parse(args);
if (options.ShowHelp)
{
    Console.WriteLine(LabOptions.HelpText);
    return 0;
}

var root = LabOptions.FindLabRoot();
var artifacts = Path.Combine(root, "artifacts", "benchmarks");
var resultsFile = options.ResultsPath ?? Path.Combine(root, "results", "benchmarks", "latest.json");

// Cross-runtime suites run on the .NET 10 (baseline) and .NET 11 jobs. Suites that only compile for net11.0
// (Zstandard, runtime async) run on the .NET 11 job only, as a second BenchmarkDotNet session.
Type[] crossRuntime = [typeof(TextBenchmarks), typeof(StreamBenchmarks), typeof(JsonBenchmarks), typeof(AsyncBenchmarks), typeof(CollectionBenchmarks), typeof(CompressionBenchmarks)];
#if NET11_0_OR_GREATER
Type[] net11Only = [typeof(ZstandardBenchmarks), typeof(RuntimeAsyncBenchmarks)];
#else
Type[] net11Only = [];
#endif

if (options.List)
{
    foreach (var t in crossRuntime) PrintBenchmarks(t, "net10 + net11");
    foreach (var t in net11Only) PrintBenchmarks(t, "net11 only");
    return 0;
}

var summaries = new List<Summary>();
var bdnArgs = options.BenchmarkDotNetArgs;
if (options.Matches(crossRuntime))
{
    summaries.AddRange(BenchmarkSwitcher.FromTypes(options.Select(crossRuntime))
        .Run(bdnArgs, LabBenchmarkConfig.Create(artifacts, options.Quick, includeNet10: true)));
}
if (options.Matches(net11Only))
{
    summaries.AddRange(BenchmarkSwitcher.FromTypes(options.Select(net11Only))
        .Run(bdnArgs, LabBenchmarkConfig.Create(artifacts, options.Quick, includeNet10: false)));
}

if (summaries.Count == 0 || summaries.All(s => s.Reports.Length == 0))
{
    Console.Error.WriteLine($"No benchmark matched filter '{string.Join(" ", options.Filters)}'. Use --list to see the names.");
    return 1;
}

if (options.WriteResults)
{
    var mode = (options.Quick ? "quick" : "full") + (options.Filters.Count > 0 ? $" (filter: {string.Join(" ", options.Filters)})" : "");
    var file = SummaryConverter.Convert(summaries, preliminary: options.Quick || options.Preliminary, mode, options.Note);
    Directory.CreateDirectory(Path.GetDirectoryName(resultsFile)!);
    File.WriteAllText(resultsFile, BenchmarkResultsJson.Serialize(file), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    File.WriteAllText(Path.ChangeExtension(resultsFile, ".md"), BenchmarkResultsJson.ToMarkdown(file), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    Console.WriteLine($"Wrote {file.Results.Count} results to {resultsFile} (preliminary: {file.Preliminary}).");
}
return summaries.Any(s => s.HasCriticalValidationErrors || s.Reports.Any(r => !r.Success)) ? 2 : 0;

static void PrintBenchmarks(Type type, string runtimes)
{
    foreach (var m in type.GetMethods().Where(m => m.IsDefined(typeof(BenchmarkDotNet.Attributes.BenchmarkAttribute), false)))
        Console.WriteLine($"{type.FullName}.{m.Name}  [{runtimes}]");
}

/// <summary>Lab-specific switches. Everything else is passed through to BenchmarkDotNet unchanged.</summary>
internal sealed class LabOptions
{
    public bool ShowHelp { get; private set; }
    public bool Quick { get; private set; }
    public bool Preliminary { get; private set; }
    public bool List { get; private set; }
    public bool WriteResults { get; private set; } = true;
    public string? ResultsPath { get; private set; }
    public string? Note { get; private set; }
    public List<string> Filters { get; } = [];
    public string[] BenchmarkDotNetArgs { get; private set; } = [];

    public const string HelpText = """
        DotNet11Lab.Benchmarks - .NET 10 vs .NET 11 BenchmarkDotNet suites for Lab 5 (and Lab 7).

        Usage (from DotNet11Lab/):
          dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- [options] [BenchmarkDotNet options]

        Options:
          --filter <glob>     Benchmarks to run (BenchmarkDotNet glob on Namespace.Type.Method, e.g. *Json*). Default: all.
          --quick             Smoke-test job (1 warm-up, 3 iterations). Results are marked preliminary.
          --preliminary       Mark the results file preliminary even for a full run (e.g. on a busy machine).
          --note <text>       Free-text note stored in the results file.
          --results <path>    Where to write the compact results (default: results/benchmarks/latest.json).
          --no-results        Do not write results/benchmarks/latest.json.
          --list              List benchmarks and the runtimes each runs on, then exit.
          --help              This text.

        Any other argument is passed to BenchmarkDotNet. Full reports (JSON + GitHub markdown) are written to
        artifacts/benchmarks/results/. See BENCHMARKS.md for methodology.
        """;

    public static LabOptions Parse(string[] args)
    {
        var o = new LabOptions();
        var passThrough = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--help" or "-h" or "-?": o.ShowHelp = true; break;
                case "--quick": o.Quick = true; break;
                case "--preliminary": o.Preliminary = true; break;
                case "--list": o.List = true; break;
                case "--no-results": o.WriteResults = false; break;
                case "--results" when i + 1 < args.Length: o.ResultsPath = Path.GetFullPath(args[++i]); break;
                case "--note" when i + 1 < args.Length: o.Note = args[++i]; break;
                case "--filter" or "-f":
                    while (i + 1 < args.Length && !args[i + 1].StartsWith('-')) o.Filters.Add(args[++i]);
                    break;
                default: passThrough.Add(args[i]); break;
            }
        }
        // Without a filter BenchmarkSwitcher would prompt interactively; default to everything.
        var filters = o.Filters.Count > 0 ? o.Filters : ["*"];
        o.BenchmarkDotNetArgs = ["--filter", .. filters, .. passThrough];
        return o;
    }

    /// <summary>Same glob semantics as BenchmarkDotNet's --filter (case-insensitive, on Namespace.Type.Method).</summary>
    private bool IsSelected(Type type, string method) =>
        Filters.Count == 0 || Filters.Any(f => FileSystemName.MatchesSimpleExpression(f, $"{type.FullName}.{method}", ignoreCase: true));

    public Type[] Select(Type[] types) => types.Where(t => t.GetMethods()
        .Any(m => m.IsDefined(typeof(BenchmarkDotNet.Attributes.BenchmarkAttribute), false) && IsSelected(t, m.Name))).ToArray();

    public bool Matches(Type[] types) => Select(types).Length > 0;

    /// <summary>The DotNet11Lab folder (holds DotNet11Lab.slnx), found by walking up from the working directory or the binary.</summary>
    public static string FindLabRoot()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "DotNet11Lab.slnx"))) return dir.FullName;
            }
        }
        return Environment.CurrentDirectory;
    }
}
