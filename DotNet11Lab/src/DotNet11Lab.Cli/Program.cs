using System.Diagnostics;
using DotNet11Lab.Cli;

// Captured before anything else so --startup-probe measures "process start -> Main" as closely as possible.
var mainEnteredTimestamp = Stopwatch.GetTimestamp();
var mainEnteredUtc = DateTime.UtcNow;

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    return await new CliApp(Console.In, Console.Out, Console.Error).RunAsync(args, mainEnteredUtc, mainEnteredTimestamp, cts.Token);
}
catch (OperationCanceledException) when (cts.IsCancellationRequested)
{
    Console.Error.WriteLine("cancelled");
    return 130;
}
