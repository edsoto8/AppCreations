using System.Diagnostics;

namespace DotNet11Lab.Core.Diagnostics;

/// <summary>Result of one in-process quick measurement. Not a substitute for BenchmarkDotNet (see Lab 5).</summary>
public sealed record Measurement(string Name, TimeSpan Elapsed, long AllocatedBytes, int Iterations, int Gen0Collections)
{
    public double MeanMicroseconds => Elapsed.TotalMicroseconds / Iterations;
    public double AllocatedBytesPerOp => (double)AllocatedBytes / Iterations;
    public double OpsPerSecond => Iterations / Elapsed.TotalSeconds;
}

/// <summary>
/// Quick, honest in-process measurement for interactive demos: a warm-up pass, then timed iterations with
/// allocation counted per thread via <see cref="GC.GetAllocatedBytesForCurrentThread"/>. Results vary by machine
/// and load; the UI labels them as "quick measurements".
/// </summary>
public static class Measure
{
    public static Measurement Run(string name, int iterations, Action action, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(iterations, 1);
        // Warm-up so tier-0 JIT and first-call costs are not attributed to the measured loop.
        for (var i = 0; i < Math.Min(iterations, 3); i++) action();

        var gen0 = GC.CollectionCount(0);
        var allocated = GC.GetAllocatedBytesForCurrentThread();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            action();
        }
        sw.Stop();
        return new Measurement(name, sw.Elapsed, GC.GetAllocatedBytesForCurrentThread() - allocated, iterations, GC.CollectionCount(0) - gen0);
    }

    /// <summary>Async variant. Allocation uses the process-wide counter because continuations may hop threads.</summary>
    public static async Task<Measurement> RunAsync(string name, int iterations, Func<Task> action, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(iterations, 1);
        for (var i = 0; i < Math.Min(iterations, 3); i++) await action().ConfigureAwait(false);

        var gen0 = GC.CollectionCount(0);
        var allocated = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await action().ConfigureAwait(false);
        }
        sw.Stop();
        return new Measurement(name, sw.Elapsed, GC.GetTotalAllocatedBytes(precise: true) - allocated, iterations, GC.CollectionCount(0) - gen0);
    }

    public static string FormatBytes(double bytes) => bytes switch
    {
        < 1024 => $"{bytes:0} B",
        < 1024 * 1024 => $"{bytes / 1024:0.0} KB",
        _ => $"{bytes / (1024 * 1024):0.00} MB",
    };

    public static string FormatDuration(double microseconds) => microseconds switch
    {
        < 1 => $"{microseconds * 1000:0} ns",
        < 1000 => $"{microseconds:0.0} µs",
        < 1_000_000 => $"{microseconds / 1000:0.00} ms",
        _ => $"{microseconds / 1_000_000:0.00} s",
    };
}
