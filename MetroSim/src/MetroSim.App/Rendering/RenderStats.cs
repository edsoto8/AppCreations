using System.Diagnostics;

namespace MetroSim.App.Rendering;

/// <summary>
/// Frame counters written by the render thread and read by the performance panel (any thread).
/// FPS counts frames actually drawn by the map, not timer callbacks.
/// </summary>
public sealed class RenderStats
{
    private const int Window = 120;
    private readonly double[] _frameMs = new double[Window];
    private readonly object _gate = new();
    private int _cursor;
    private int _filled;
    private long _frames;
    private long _windowStart = Stopwatch.GetTimestamp();
    private long _windowFrames;
    private double _fps;

    public long Frames => Interlocked.Read(ref _frames);

    /// <summary>Frames drawn per second over the last ~second.</summary>
    public double FramesPerSecond
    {
        get
        {
            lock (_gate)
            {
                Roll(Stopwatch.GetTimestamp());
                return _fps;
            }
        }
    }

    /// <summary>Mean and worst draw time of the map over the last 120 frames.</summary>
    public (double Average, double Max) FrameMilliseconds
    {
        get
        {
            lock (_gate)
            {
                if (_filled == 0)
                {
                    return (0, 0);
                }

                double sum = 0;
                double max = 0;
                for (int i = 0; i < _filled; i++)
                {
                    sum += _frameMs[i];
                    max = Math.Max(max, _frameMs[i]);
                }

                return (sum / _filled, max);
            }
        }
    }

    /// <summary>UI-thread time to build the last frame snapshot (includes waiting for the state lock).</summary>
    public double SnapshotMilliseconds { get; set; }

    public int VisibleVehicles { get; set; }

    public int CachedChunks { get; set; }

    public long CachedBytes { get; set; }

    public int ChunksPaintedLastFrame { get; set; }

    /// <summary>Frames that redrew the previous simulation data because the state lock was busy.</summary>
    public long StaleFrames { get; set; }

    /// <summary>Forgets the frame-time window (benchmarks measure a steady state).</summary>
    public void ResetFrameTimes()
    {
        lock (_gate)
        {
            _filled = 0;
            _cursor = 0;
        }
    }

    public void RecordFrame(double milliseconds)
    {
        lock (_gate)
        {
            _frameMs[_cursor] = milliseconds;
            _cursor = (_cursor + 1) % Window;
            _filled = Math.Min(Window, _filled + 1);
            _frames++;
            _windowFrames++;
            Roll(Stopwatch.GetTimestamp());
        }
    }

    private void Roll(long now)
    {
        double seconds = (now - _windowStart) / (double)Stopwatch.Frequency;
        if (seconds >= 1)
        {
            _fps = _windowFrames / seconds;
            _windowFrames = 0;
            _windowStart = now;
        }
    }
}
