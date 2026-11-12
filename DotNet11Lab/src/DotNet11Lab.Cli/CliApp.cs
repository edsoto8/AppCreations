using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace DotNet11Lab.Cli;

/// <summary>Argument dispatch for <c>dotnet11lab</c>. Takes its I/O as parameters so tests can drive it in-process.</summary>
public sealed class CliApp(TextReader stdin, TextWriter stdout, TextWriter stderr)
{
    public const int Ok = 0, UsageError = 2, Failure = 1;

    public static string Version =>
        typeof(CliApp).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

    public const string HelpText = """
        dotnet11lab - DotNet 11 Lab companion CLI (Lab 8: Native AOT & publishing)

        Usage:
          dotnet11lab stats <file|-> [--json]        Summarise a JSON Lines file of transactions ('-' = stdin)
          dotnet11lab gen <count> [--seed <n>] [--out <file>]
                                                     Write <count> sample transactions as JSON Lines (max 10,000,000)
          dotnet11lab compress <in> <out> [--quality <n>]
                                                     Zstandard-compress a file (System.IO.Compression.ZstandardStream)
          dotnet11lab decompress <in> <out>          Decompress a Zstandard file
          dotnet11lab --startup-probe                Print one JSON line: startup time, memory, runtime facts
          dotnet11lab --version | --help

        Example:
          dotnet11lab gen 100000 --out tx.jsonl && dotnet11lab stats tx.jsonl
        """;

    public async Task<int> RunAsync(string[] args, DateTime mainEnteredUtc, long mainEnteredTimestamp, CancellationToken cancellationToken)
    {
        if (args.Length == 0 || args[0] is "--help" or "-h" or "-?" or "help")
        {
            await stdout.WriteAsync(HelpText).ConfigureAwait(false);
            return args.Length == 0 ? UsageError : Ok;
        }
        try
        {
            return args[0] switch
            {
                "--startup-probe" => await ProbeAsync(mainEnteredUtc, mainEnteredTimestamp).ConfigureAwait(false),
                "--version" => await WriteLineAsync(stdout, Version).ConfigureAwait(false),
                "stats" => await StatsAsync(args[1..], cancellationToken).ConfigureAwait(false),
                "gen" => await GenerateAsync(args[1..], cancellationToken).ConfigureAwait(false),
                "compress" or "decompress" => await CompressAsync(args[0], args[1..], cancellationToken).ConfigureAwait(false),
                _ => await UsageAsync($"Unknown command '{args[0]}'.").ConfigureAwait(false),
            };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidDataException)
        {
            await stderr.WriteLineAsync($"error: {ex.Message}").ConfigureAwait(false);
            return Failure;
        }
    }

    private async Task<int> ProbeAsync(DateTime mainEnteredUtc, long mainEnteredTimestamp)
    {
        var result = StartupProbe.Capture(mainEnteredUtc, mainEnteredTimestamp);
        return await WriteLineAsync(stdout, JsonSerializer.Serialize(result, CliJsonContext.Default.StartupProbeResult)).ConfigureAwait(false);
    }

    private async Task<int> StatsAsync(string[] args, CancellationToken cancellationToken)
    {
        var json = args.Contains("--json");
        var paths = args.Where(a => a != "--json").ToArray();
        if (paths.Length != 1) return await UsageAsync("stats expects exactly one input: a file path or '-'.").ConfigureAwait(false);

        StatsReport report;
        if (paths[0] == "-")
        {
            report = await StatsCommand.ComputeAsync(stdin, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            using var reader = new StreamReader(paths[0], Encoding.UTF8);
            report = await StatsCommand.ComputeAsync(reader, cancellationToken).ConfigureAwait(false);
        }
        await stdout.WriteAsync(json
            ? JsonSerializer.Serialize(report, CliJsonContext.Default.StatsReport) + Environment.NewLine
            : StatsCommand.FormatText(report)).ConfigureAwait(false);
        return report.Transactions == 0 && report.InvalidLines > 0 ? Failure : Ok;
    }

    private async Task<int> GenerateAsync(string[] args, CancellationToken cancellationToken)
    {
        if (args.Length == 0 || !int.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out var count) || count > GenerateCommand.MaxCount)
            return await UsageAsync($"gen expects a count between 0 and {GenerateCommand.MaxCount:N0}.").ConfigureAwait(false);
        var seed = 42;
        string? outPath = null;
        for (var i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--seed" when i + 1 < args.Length && int.TryParse(args[i + 1], CultureInfo.InvariantCulture, out seed): i++; break;
                case "--out" when i + 1 < args.Length: outPath = args[++i]; break;
                default: return await UsageAsync($"Unexpected argument '{args[i]}'.").ConfigureAwait(false);
            }
        }
        if (outPath is null)
        {
            await GenerateCommand.WriteAsync(stdout, count, seed, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await using var writer = new StreamWriter(outPath, append: false, new UTF8Encoding(false));
            await GenerateCommand.WriteAsync(writer, count, seed, cancellationToken).ConfigureAwait(false);
            await stderr.WriteLineAsync($"wrote {count:N0} transactions to {outPath}").ConfigureAwait(false);
        }
        return Ok;
    }

    private async Task<int> CompressAsync(string command, string[] args, CancellationToken cancellationToken)
    {
        var quality = 3;
        var positional = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--quality" && command == "compress" && i + 1 < args.Length && int.TryParse(args[i + 1], CultureInfo.InvariantCulture, out quality)) i++;
            else if (args[i].StartsWith("--", StringComparison.Ordinal)) return await UsageAsync($"Unexpected option '{args[i]}'.").ConfigureAwait(false);
            else positional.Add(args[i]);
        }
        if (positional.Count != 2) return await UsageAsync($"{command} expects <in> <out>.").ConfigureAwait(false);
        if (Path.GetFullPath(positional[0]) == Path.GetFullPath(positional[1])) return await UsageAsync("Input and output must be different files.").ConfigureAwait(false);

        await using var input = File.OpenRead(positional[0]);
        await using var output = File.Create(positional[1]);
        var report = command == "compress"
            ? await CompressCommand.CompressAsync(input, output, quality, cancellationToken).ConfigureAwait(false)
            : await CompressCommand.DecompressAsync(input, output, cancellationToken).ConfigureAwait(false);
        report = report with { Input = positional[0], Output = positional[1] };
        return await WriteLineAsync(stdout, JsonSerializer.Serialize(report, CliJsonContext.Default.CompressReport)).ConfigureAwait(false);
    }

    private async Task<int> UsageAsync(string message)
    {
        await stderr.WriteLineAsync($"error: {message}").ConfigureAwait(false);
        await stderr.WriteLineAsync("Run 'dotnet11lab --help' for usage.").ConfigureAwait(false);
        return UsageError;
    }

    private static async Task<int> WriteLineAsync(TextWriter writer, string text)
    {
        await writer.WriteLineAsync(text).ConfigureAwait(false);
        return Ok;
    }
}
