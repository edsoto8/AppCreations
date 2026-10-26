using System.Diagnostics;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Traffic;
using MetroSim.Core.World;

namespace MetroSim.App.Rendering;

/// <summary>
/// Remembers where every vehicle was at the previously seen tick (UI thread) and turns the change into
/// <see cref="VehicleSprite"/> polylines, so the renderer can move vehicles smoothly between ticks
/// along their actual route (including corners) instead of jumping a tile per tick.
/// </summary>
public sealed class VehicleTracker
{
    /// <summary>Lane centre offset from the road centre line, in tiles (drive on the right).</summary>
    public const float StreetLane = 0.13f;
    public const float AvenueInnerLane = 0.11f;
    public const float AvenueOuterLane = 0.27f;
    public const float StreetSidewalk = 0.35f;
    public const float AvenueSidewalk = 0.45f;

    private readonly Dictionary<int, Track> _tracks = [];
    private readonly List<int> _stale = [];
    private Simulation? _simulation;
    private long _tick = -1;
    private long _tickSeen;
    private double _interval = 1.0 / 12;
    private VehicleSprite[] _sprites = [];
    private int _count;
    private int _pass;

    public VehicleSprite[] Sprites => _sprites;

    public int Count => _count;

    public long TickSeenTimestamp => _tickSeen;

    public double TickIntervalSeconds => _interval;

    /// <summary>
    /// Call with the state lock held, once per frame. Rebuilds the sprites only when a new tick has
    /// completed; between ticks the previous (immutable) array is reused.
    /// </summary>
    public void Update(Simulation sim, SimulationSpeed speed)
    {
        long now = Stopwatch.GetTimestamp();
        if (!ReferenceEquals(sim, _simulation))
        {
            _simulation = sim;
            _tracks.Clear();
            _tick = -1;
        }

        if (sim.Tick == _tick)
        {
            return;
        }

        if (_tick >= 0 && sim.Tick > _tick)
        {
            double seen = (now - _tickSeen) / (double)Stopwatch.Frequency;
            double target = SimulationRunner.TargetTicksPerSecond(speed) is > 0 and < int.MaxValue and var tps ? 1.0 / tps : seen;
            // Smooth the observed interval but never stretch motion beyond the nominal tick length much.
            _interval = Math.Clamp(_interval * 0.7 + Math.Min(seen, target * 1.5) * 0.3, 1.0 / 500, 0.5);
        }

        _tick = sim.Tick;
        _tickSeen = now;
        _pass++;
        Rebuild(sim);
    }

    /// <summary>Lane-offset position of a vehicle state, in tile coordinates.</summary>
    public static (float X, float Y) Position(CityMap map, int[] path, int pathIndex, int progress, VehicleKind kind, int id)
    {
        int tile = path[Math.Clamp(pathIndex, 0, path.Length - 1)];
        int next = pathIndex + 1 < path.Length ? path[pathIndex + 1] : tile;
        float cx = map.X(tile) + 0.5f;
        float cy = map.Y(tile) + 0.5f;
        if (next == tile)
        {
            return (cx, cy);
        }

        var dir = Directions.Between(tile, next);
        float f = Math.Clamp(progress, 0, 1000) / 1000f;
        float dx = Directions.Dx[(int)dir];
        float dy = Directions.Dy[(int)dir];
        float offset = LaneOffset(map.Roads[tile], kind, id);
        // Right-hand side of the travel direction in y-down screen space is (-dy, dx).
        return (cx + dx * f - dy * offset, cy + dy * f + dx * offset);
    }

    public static float LaneOffset(RoadType road, VehicleKind kind, int id) => kind switch
    {
        VehicleKind.Pedestrian => road == RoadType.Avenue ? AvenueSidewalk : StreetSidewalk,
        _ when road == RoadType.Avenue => (id & 1) == 0 ? AvenueInnerLane : AvenueOuterLane,
        _ => StreetLane,
    };

    private void Rebuild(Simulation sim)
    {
        var map = sim.Map;
        var vehicles = sim.Traffic.Vehicles;
        var sprites = new VehicleSprite[vehicles.Count];
        int n = 0;
        foreach (var v in vehicles)
        {
            if (!v.InLane || v.Path.Length == 0)
            {
                continue;
            }

            var current = Position(map, v.Path, v.PathIndex, v.Progress, v.Kind, v.Id);
            var sprite = new VehicleSprite
            {
                Id = v.Id,
                Kind = v.Kind switch
                {
                    VehicleKind.Pedestrian => SpriteKind.Pedestrian,
                    VehicleKind.FireTruck => SpriteKind.FireTruck,
                    _ => SpriteKind.Car,
                },
                EndHeading = v.Lane,
                StartHeading = v.Lane,
            };

            if (_tracks.TryGetValue(v.Id, out var track) && track.StartTick == v.StartTick && track.CitizenId == v.CitizenId)
            {
                sprite.StartHeading = track.Lane;
                if (ReferenceEquals(track.Path, v.Path) && track.PathIndex <= v.PathIndex)
                {
                    BuildPolyline(ref sprite, map, v, track, current);
                }
                else
                {
                    // Re-routed: glide in a straight line from where it was drawn.
                    var previous = Position(map, track.Path, track.PathIndex, track.Progress, v.Kind, v.Id);
                    sprite.SetPoint(0, previous.X, previous.Y);
                    sprite.SetPoint(1, current.X, current.Y);
                    sprite.PointCount = 2;
                }
            }
            else
            {
                sprite.SetPoint(0, current.X, current.Y);
                sprite.PointCount = 1;
            }

            sprites[n++] = sprite;
            _tracks[v.Id] = new Track(v.StartTick, v.CitizenId, v.Path, v.PathIndex, v.Progress, v.Lane, _pass);
        }

        // Forget vehicles that finished their trip.
        _stale.Clear();
        foreach (var (id, track) in _tracks)
        {
            if (track.Pass != _pass)
            {
                _stale.Add(id);
            }
        }

        foreach (int id in _stale)
        {
            _tracks.Remove(id);
        }

        _sprites = sprites;
        _count = n;
    }

    /// <summary>Previous position, the corners passed since (lane-offset), then the current position.</summary>
    private static void BuildPolyline(ref VehicleSprite sprite, CityMap map, Vehicle v, Track track, (float X, float Y) current)
    {
        var previous = Position(map, track.Path, track.PathIndex, track.Progress, v.Kind, v.Id);
        Span<(float X, float Y)> corners = stackalloc (float, float)[2];
        int cornerCount = 0;
        for (int k = track.PathIndex + 1; k <= v.PathIndex && k + 1 < v.Path.Length; k++)
        {
            var dirIn = Directions.Between(v.Path[k - 1], v.Path[k]);
            var dirOut = Directions.Between(v.Path[k], v.Path[k + 1]);
            if (dirIn == dirOut)
            {
                continue;
            }

            int tile = v.Path[k];
            float offset = LaneOffset(map.Roads[tile], v.Kind, v.Id);
            float cx = map.X(tile) + 0.5f;
            float cy = map.Y(tile) + 0.5f;
            // Where the incoming and outgoing lane centre lines cross.
            float ox = (-Directions.Dy[(int)dirIn] - Directions.Dy[(int)dirOut]) * offset;
            float oy = (Directions.Dx[(int)dirIn] + Directions.Dx[(int)dirOut]) * offset;
            var corner = (cx + ox, cy + oy);
            if (cornerCount < corners.Length)
            {
                corners[cornerCount++] = corner;
            }
            else
            {
                // Many ticks passed between frames: keep the two most recent corners.
                corners[0] = corners[1];
                corners[1] = corner;
            }
        }

        int p = 0;
        sprite.SetPoint(p++, previous.X, previous.Y);
        for (int i = 0; i < cornerCount; i++)
        {
            sprite.SetPoint(p++, corners[i].X, corners[i].Y);
        }

        sprite.SetPoint(p++, current.X, current.Y);
        sprite.PointCount = (byte)p;
    }

    private readonly record struct Track(long StartTick, int CitizenId, int[] Path, int PathIndex, int Progress, Direction Lane, int Pass);
}
