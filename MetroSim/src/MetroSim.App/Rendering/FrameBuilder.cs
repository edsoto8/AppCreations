using System.Diagnostics;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;

namespace MetroSim.App.Rendering;

/// <summary>
/// Builds one <see cref="FrameSnapshot"/> per frame on the UI thread. All reads of the live simulation
/// happen inside a single <c>lock (runner.StateLock)</c>; expensive copies are made only when their
/// source changed (map version, tick, hour), so a typical frame holds the lock for well under a
/// millisecond.
/// </summary>
public sealed class FrameBuilder
{
    /// <summary>Live overlays (traffic, fire) are rebuilt at most this often.</summary>
    private const double LiveOverlayIntervalSeconds = 0.1;

    /// <summary>Simulation-driven map changes are picked up at most this often.</summary>
    private const double MinStaticIntervalSeconds = 0.2;

    private readonly StaticSnapshotBuilder _static = new();
    private readonly VehicleTracker _vehicles = new();
    private Simulation? _simulation;
    private long _spritesTick = -1;
    private int _spritesVersion = -1;
    private FireSprite[] _fires = [];
    private AlertSprite[] _alerts = [];
    private OverlayLayer? _overlay;
    private OverlayKind _overlayKind;
    private long _overlayTick = -1;
    private int _overlayMapVersion = -1;
    private long _overlayBuiltAt;
    private int _overlayVersion;
    private SelectionSprite? _selection;
    private MapSelection? _selectionSource;
    private long _selectionTick = -1;
    private FrameSnapshot? _last;
    private long _staticBuiltAt;
    private bool _forceStatic;

    public StaticSnapshot? Static => _static.Last;

    /// <summary>
    /// How long a frame waits for the state lock. At max speed the simulation thread re-takes the lock
    /// back-to-back; rather than stall the frame, the previous simulation data is drawn again with the
    /// current camera (vehicles hold still for that frame).
    /// </summary>
    public TimeSpan LockTimeout { get; set; } = TimeSpan.FromMilliseconds(4);

    /// <summary>Frames that reused the previous simulation data because the lock was busy.</summary>
    public long StaleFrames { get; private set; }

    /// <summary>Makes the next frame pick up map changes immediately (after the player's own command).</summary>
    public void RefreshStaticNow() => _forceStatic = true;

    public FrameSnapshot Build(SimulationRunner runner, CameraView camera, OverlayKind overlay, ToolPreview? preview,
        MapSelection selection, bool showGrid)
    {
        var speed = runner.Speed;
        bool locked = false;
        try
        {
            Monitor.TryEnter(runner.StateLock, _last is null ? Timeout.InfiniteTimeSpan : LockTimeout, ref locked);
            if (!locked)
            {
                StaleFrames++;
                return _last! with { Camera = camera, Preview = preview, ShowGrid = showGrid };
            }

            var sim = runner.Simulation;
            bool replaced = !ReferenceEquals(sim, _simulation);
            _simulation = sim;
            long now = Stopwatch.GetTimestamp();
            // At high speed the map changes almost every frame; re-copying it (and repainting chunks)
            // a few times a second looks the same and costs far less. Player commands force a refresh.
            bool staticDue = _static.IsStale(sim) && (replaced || _forceStatic || _static.Last is null
                || Stopwatch.GetElapsedTime(_staticBuiltAt, now).TotalSeconds >= MinStaticIntervalSeconds);
            if (staticDue)
            {
                _static.Build(sim);
                _staticBuiltAt = now;
                _forceStatic = false;
            }

            var staticLayer = _static.Last!;
            _vehicles.Update(sim, speed);

            if (replaced || sim.Tick != _spritesTick || staticLayer.MapVersion != _spritesVersion)
            {
                BuildSprites(sim);
                _spritesTick = sim.Tick;
                _spritesVersion = staticLayer.MapVersion;
            }

            UpdateOverlay(sim, overlay, replaced);
            UpdateSelection(sim, selection, replaced);

            return _last = new FrameSnapshot
            {
                Camera = camera,
                Static = staticLayer,
                Vehicles = _vehicles.Sprites,
                VehicleCount = _vehicles.Count,
                TickSeenTimestamp = _vehicles.TickSeenTimestamp,
                TickIntervalSeconds = _vehicles.TickIntervalSeconds,
                Paused = speed == SimulationSpeed.Paused,
                Fires = _fires,
                Alerts = _alerts,
                Overlay = _overlay,
                Preview = preview,
                Selection = _selection,
                ShowGrid = showGrid,
            };
        }
        finally
        {
            if (locked)
            {
                Monitor.Exit(runner.StateLock);
            }
        }
    }

    private void BuildSprites(Simulation sim)
    {
        var fires = new List<FireSprite>();
        var alerts = new List<AlertSprite>();
        foreach (var b in sim.Buildings)
        {
            if (b.IsBurning)
            {
                fires.Add(new FireSprite(b.Id, b.X, b.Y, b.Size, b.FireDamage));
            }

            if (!b.IsOperating || b.Spec.PowerOutput > 0)
            {
                continue;
            }

            bool noPower = b.PowerUse > 0 && !b.Powered;
            bool noWater = b.WaterUse > 0 && !b.Watered;
            if (noPower || noWater)
            {
                alerts.Add(new AlertSprite(b.X, b.Y, b.Size, noPower, noWater));
            }
        }

        _fires = [.. fires];
        _alerts = [.. alerts];
    }

    private void UpdateOverlay(Simulation sim, OverlayKind kind, bool replaced)
    {
        if (kind == OverlayKind.None)
        {
            _overlay = null;
            _overlayKind = kind;
            return;
        }

        long now = Stopwatch.GetTimestamp();
        bool due = replaced || kind != _overlayKind || _overlay is null || sim.Map.Version != _overlayMapVersion;
        if (!due && sim.Tick != _overlayTick)
        {
            due = OverlayBuilder.IsLive(kind)
                ? Stopwatch.GetElapsedTime(_overlayBuiltAt, now).TotalSeconds >= LiveOverlayIntervalSeconds
                // Utilities refresh every 10 ticks, land value and pollution hourly.
                : sim.Tick / Simulation.UtilityInterval != _overlayTick / Simulation.UtilityInterval;
        }

        if (!due)
        {
            return;
        }

        _overlay = OverlayBuilder.Build(sim, kind, ++_overlayVersion);
        _overlayKind = kind;
        _overlayTick = sim.Tick;
        _overlayMapVersion = sim.Map.Version;
        _overlayBuiltAt = now;
    }

    private void UpdateSelection(Simulation sim, MapSelection selection, bool replaced)
    {
        if (!replaced && ReferenceEquals(selection, _selectionSource) && sim.Tick == _selectionTick)
        {
            return;
        }

        _selectionSource = selection;
        _selectionTick = sim.Tick;
        _selection = selection.Kind switch
        {
            SelectionKind.Building when sim.Buildings[selection.Id] is { } b =>
                new SelectionSprite(new TileRect(b.X, b.Y, b.X + b.Size - 1, b.Y + b.Size - 1), null, 0),
            SelectionKind.Road or SelectionKind.Tile when selection.Tile >= 0 && selection.Tile < sim.Map.TileCount =>
                new SelectionSprite(new TileRect(sim.Map.X(selection.Tile), sim.Map.Y(selection.Tile), sim.Map.X(selection.Tile), sim.Map.Y(selection.Tile)), null, 0),
            SelectionKind.Vehicle when sim.Traffic.Vehicles[selection.Id] is { } v && v.Path.Length > 0 =>
                new SelectionSprite(null, v.Path[Math.Min(v.PathIndex, v.Path.Length - 1)..], v.Id),
            _ => null,
        };
    }
}
