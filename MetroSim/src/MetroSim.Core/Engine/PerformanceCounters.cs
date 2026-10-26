using System.Diagnostics;

namespace MetroSim.Core.Engine;

/// <summary>Wall-clock measurements. Never saved and never read by simulation rules.</summary>
public sealed class PerformanceCounters
{
    private const int Window = 256;
    private readonly long[] _tickDurations = new long[Window];
    private int _cursor;
    private int _filled;

    public long TicksExecuted { get; private set; }

    public long TotalTickTimestamp { get; private set; }

    public double LastTickMilliseconds { get; private set; }

    /// <summary>Mean tick time over the last 256 ticks.</summary>
    public double AverageTickMilliseconds
    {
        get
        {
            if (_filled == 0)
            {
                return 0;
            }

            long sum = 0;
            for (int i = 0; i < _filled; i++)
            {
                sum += _tickDurations[i];
            }

            return sum * 1000.0 / Stopwatch.Frequency / _filled;
        }
    }

    public double MaxTickMilliseconds
    {
        get
        {
            long max = 0;
            for (int i = 0; i < _filled; i++)
            {
                max = Math.Max(max, _tickDurations[i]);
            }

            return max * 1000.0 / Stopwatch.Frequency;
        }
    }

    internal void Record(long elapsedTimestamp)
    {
        TicksExecuted++;
        TotalTickTimestamp += elapsedTimestamp;
        LastTickMilliseconds = elapsedTimestamp * 1000.0 / Stopwatch.Frequency;
        _tickDurations[_cursor] = elapsedTimestamp;
        _cursor = (_cursor + 1) % Window;
        _filled = Math.Min(Window, _filled + 1);
    }
}
