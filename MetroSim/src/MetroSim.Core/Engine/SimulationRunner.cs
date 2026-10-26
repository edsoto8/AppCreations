using System.Diagnostics;

namespace MetroSim.Core.Engine;

public enum SimulationSpeed
{
    Paused = 0,
    Normal = 1,
    Fast = 2,
    Faster = 3,
    Unlimited = 4,
}

/// <summary>
/// Runs a <see cref="Simulation"/> on a background thread at a chosen speed. Every tick and every
/// command runs while holding <see cref="StateLock"/>; readers (the renderer) take the same lock
/// while they read state, so they always see a state between two ticks.
/// </summary>
public sealed class SimulationRunner : IDisposable
{
    private readonly Thread _thread;
    private readonly ManualResetEventSlim _wake = new(false);
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private volatile bool _stopping;
    private volatile SimulationSpeed _speed = SimulationSpeed.Paused;
    private Simulation _simulation;
    private long _windowStartTicks;
    private long _windowStartTime;
    private double _measuredTps;

    public SimulationRunner(Simulation simulation)
    {
        _simulation = simulation;
        _thread = new Thread(Loop) { IsBackground = true, Name = "MetroSim simulation" };
        _thread.Start();
    }

    public object StateLock { get; } = new();

    /// <summary>The live simulation. Read its state only while holding <see cref="StateLock"/>.</summary>
    public Simulation Simulation => _simulation;

    public SimulationSpeed Speed
    {
        get => _speed;
        set
        {
            _speed = value;
            _wake.Set();
        }
    }

    /// <summary>Optional hook run on the simulation thread after every hour (e.g. an auto-player).</summary>
    public Action<Simulation>? HourlyHook { get; set; }

    /// <summary>Ticks actually executed per second over the last measurement window.</summary>
    public double MeasuredTicksPerSecond => Volatile.Read(ref _measuredTps);

    public static int TargetTicksPerSecond(SimulationSpeed speed) => speed switch
    {
        SimulationSpeed.Normal => 12,
        SimulationSpeed.Fast => 48,
        SimulationSpeed.Faster => 192,
        SimulationSpeed.Unlimited => int.MaxValue,
        _ => 0,
    };

    /// <summary>Applies a command right now, between two ticks, and returns its result.</summary>
    public CommandResult Execute(GameCommand command)
    {
        lock (StateLock)
        {
            return _simulation.Execute(command);
        }
    }

    public CommandResult Estimate(GameCommand command)
    {
        lock (StateLock)
        {
            return _simulation.Estimate(command);
        }
    }

    /// <summary>Swaps in another simulation (new game, loaded game).</summary>
    public void Replace(Simulation simulation)
    {
        lock (StateLock)
        {
            _simulation = simulation;
            _windowStartTicks = simulation.Tick;
            _windowStartTime = _clock.ElapsedTicks;
        }
    }

    /// <summary>Runs <paramref name="ticks"/> ticks synchronously on the caller's thread (tests, tools).</summary>
    public void StepNow(int ticks)
    {
        for (int i = 0; i < ticks; i++)
        {
            lock (StateLock)
            {
                StepOnce();
            }
        }
    }

    public void Dispose()
    {
        _stopping = true;
        _wake.Set();
        _thread.Join(TimeSpan.FromSeconds(2));
        _wake.Dispose();
    }

    private void StepOnce()
    {
        _simulation.Step();
        if (_simulation.Tick % Simulation.TicksPerHour == 0)
        {
            HourlyHook?.Invoke(_simulation);
        }
    }

    private void Loop()
    {
        double owed = 0;
        long last = _clock.ElapsedTicks;
        while (!_stopping)
        {
            var speed = _speed;
            if (speed == SimulationSpeed.Paused)
            {
                _measuredTps = 0;
                _wake.Wait(100);
                _wake.Reset();
                last = _clock.ElapsedTicks;
                owed = 0;
                ResetWindow();
                continue;
            }

            long now = _clock.ElapsedTicks;
            double seconds = (now - last) / (double)Stopwatch.Frequency;
            last = now;
            int due;
            if (speed == SimulationSpeed.Unlimited)
            {
                due = int.MaxValue;
            }
            else
            {
                owed = Math.Min(owed + seconds * TargetTicksPerSecond(speed), TargetTicksPerSecond(speed) / 4.0 + 1);
                due = (int)owed;
                owed -= due;
            }

            // Run due ticks, but give readers a chance at the lock at least every ~8 ms.
            long sliceStart = _clock.ElapsedTicks;
            long sliceLimit = Stopwatch.Frequency / 125;
            int ran = 0;
            while (ran < due && !_stopping && _speed == speed && _clock.ElapsedTicks - sliceStart < sliceLimit)
            {
                lock (StateLock)
                {
                    StepOnce();
                }

                ran++;
            }

            if (speed != SimulationSpeed.Unlimited && ran < due)
            {
                owed += due - ran;
            }

            UpdateMeasurement();
            Thread.Sleep(speed == SimulationSpeed.Unlimited ? 0 : 1);
        }
    }

    private void ResetWindow()
    {
        lock (StateLock)
        {
            _windowStartTicks = _simulation.Tick;
            _windowStartTime = _clock.ElapsedTicks;
        }
    }

    private void UpdateMeasurement()
    {
        long now = _clock.ElapsedTicks;
        double seconds = (now - _windowStartTime) / (double)Stopwatch.Frequency;
        if (seconds < 0.5)
        {
            return;
        }

        long ticks;
        lock (StateLock)
        {
            ticks = _simulation.Tick - _windowStartTicks;
            _windowStartTicks = _simulation.Tick;
        }

        _windowStartTime = now;
        Volatile.Write(ref _measuredTps, Math.Max(0, ticks / seconds));
    }
}
