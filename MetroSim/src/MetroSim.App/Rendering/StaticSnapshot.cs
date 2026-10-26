using System.Runtime.InteropServices;
using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.App.Rendering;

[Flags]
public enum BuildingLook : byte
{
    None = 0,
    UnderConstruction = 1,
    Abandoned = 2,
}

/// <summary>What the cached map layer needs to know about a building (no live counters).</summary>
public readonly record struct BuildingVisual(BuildingKind Kind, short X, short Y, byte Size, byte Level, BuildingLook Look)
{
    public bool Exists => Size > 0;
}

/// <summary>
/// Immutable copy of everything the cached (static) map layer draws: terrain, trees, zones, roads,
/// power lines and building looks. Built on the UI thread under the state lock whenever
/// <see cref="CityMap.Version"/> changes, then handed to the render thread, which never touches the
/// live simulation. Arrays that did not change are shared with the previous snapshot.
/// </summary>
public sealed class StaticSnapshot
{
    public const int ChunkSize = 16;

    public required int Generation { get; init; }

    public required int MapVersion { get; init; }

    public required int Width { get; init; }

    public required int Height { get; init; }

    public required int WaterLevel { get; init; }

    public required byte[] Elevation { get; init; }

    public required TerrainType[] Terrain { get; init; }

    public required byte[] Trees { get; init; }

    public required RoadType[] Roads { get; init; }

    public required ZoneType[] Zones { get; init; }

    public required int[] BuildingAt { get; init; }

    public required bool[] PowerLines { get; init; }

    /// <summary>Indexed by building id; entries with Size 0 are free slots.</summary>
    public required BuildingVisual[] Buildings { get; init; }

    /// <summary>Per-chunk change counters; a cached chunk image is valid while its stamp matches.</summary>
    public required int[] ChunkStamps { get; init; }

    /// <summary>Tile indices of wind turbines (their blades are animated in the dynamic layer).</summary>
    public required int[] WindTurbines { get; init; }

    public int ChunksX => (Width + ChunkSize - 1) / ChunkSize;

    public int ChunksY => (Height + ChunkSize - 1) / ChunkSize;

    public bool IsRoad(int x, int y) => (uint)x < (uint)Width && (uint)y < (uint)Height && Roads[y * Width + x] != RoadType.None;

    public BuildingVisual BuildingOn(int tile)
    {
        int id = BuildingAt[tile];
        return id > 0 && id < Buildings.Length ? Buildings[id] : default;
    }
}

/// <summary>
/// Produces <see cref="StaticSnapshot"/>s (UI thread). Keeps a per-tile signature of everything that
/// affects a tile's look and bumps the stamp of every chunk whose signature changed, so the renderer
/// redraws only the chunks that actually changed.
/// </summary>
public sealed class StaticSnapshotBuilder
{
    private Simulation? _simulation;
    private StaticSnapshot? _last;
    private uint[] _signatures = [];
    private int[] _stamps = [];
    private int _generation;

    public StaticSnapshot? Last => _last;

    /// <summary>True when the map changed (or the simulation was replaced) since the last build.</summary>
    public bool IsStale(Simulation sim) => _last is null || !ReferenceEquals(sim, _simulation) || _last.MapVersion != sim.Map.Version;

    /// <summary>Call with the state lock held.</summary>
    public StaticSnapshot Build(Simulation sim)
    {
        var map = sim.Map;
        bool fresh = !ReferenceEquals(sim, _simulation) || _last is null || _last.Width != map.Width || _last.Height != map.Height;
        if (fresh)
        {
            _simulation = sim;
            _generation++;
            _signatures = new uint[map.TileCount];
            int chunks = ((map.Width + StaticSnapshot.ChunkSize - 1) / StaticSnapshot.ChunkSize)
                * ((map.Height + StaticSnapshot.ChunkSize - 1) / StaticSnapshot.ChunkSize);
            _stamps = new int[chunks];
        }

        var buildings = new BuildingVisual[sim.Buildings.HighWater];
        var turbines = new List<int>();
        foreach (var b in sim.Buildings)
        {
            var look = (b.IsComplete ? BuildingLook.None : BuildingLook.UnderConstruction)
                | (b.Abandoned ? BuildingLook.Abandoned : BuildingLook.None);
            buildings[b.Id] = new BuildingVisual(b.Kind, (short)b.X, (short)b.Y, (byte)b.Size, (byte)b.Level, look);
            if (b.Kind == BuildingKind.WindTurbine && b.IsOperating)
            {
                turbines.Add(map.Index(b.X, b.Y));
            }
        }

        var prev = fresh ? null : _last;
        var snapshot = new StaticSnapshot
        {
            Generation = _generation,
            MapVersion = map.Version,
            Width = map.Width,
            Height = map.Height,
            WaterLevel = sim.WaterLevel,
            Elevation = Share(prev?.Elevation, map.Elevation),
            Terrain = Share(prev?.Terrain, map.Terrain),
            Trees = Share(prev?.Trees, map.Trees),
            Roads = Share(prev?.Roads, map.Roads),
            Zones = Share(prev?.Zones, map.Zones),
            BuildingAt = Share(prev?.BuildingAt, map.BuildingAt),
            PowerLines = Share(prev?.PowerLines, map.PowerLines),
            Buildings = buildings,
            ChunkStamps = _stamps,
            WindTurbines = turbines.ToArray(),
        };

        MarkChangedChunks(snapshot, fresh);
        // Stamps are copied so this snapshot stays immutable while the builder keeps counting.
        _stamps = (int[])_stamps.Clone();
        _last = snapshot;
        return snapshot;
    }

    private void MarkChangedChunks(StaticSnapshot s, bool fresh)
    {
        int w = s.Width;
        int cx = s.ChunksX;
        var dirty = new bool[s.ChunkStamps.Length];
        for (int y = 0; y < s.Height; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int t = y * w + x;
                uint sig = Signature(s, t);
                if (!fresh && sig == _signatures[t])
                {
                    continue;
                }

                _signatures[t] = sig;
                // A tile's look depends on its neighbours (road arms, power line hops), so the chunks of
                // the 4-neighbours are refreshed too.
                Mark(x, y);
                Mark(x - 1, y);
                Mark(x + 1, y);
                Mark(x, y - 1);
                Mark(x, y + 1);
            }
        }

        for (int i = 0; i < dirty.Length; i++)
        {
            if (dirty[i] || fresh)
            {
                s.ChunkStamps[i]++;
            }
        }

        void Mark(int x, int y)
        {
            if ((uint)x < (uint)w && (uint)y < (uint)s.Height)
            {
                dirty[y / StaticSnapshot.ChunkSize * cx + x / StaticSnapshot.ChunkSize] = true;
            }
        }
    }

    private static uint Signature(StaticSnapshot s, int t)
    {
        uint h = (uint)s.Terrain[t] | (uint)s.Elevation[t] << 2 | (uint)s.Trees[t] << 10 | (uint)s.Roads[t] << 12
            | (uint)s.Zones[t] << 14 | (s.PowerLines[t] ? 1u : 0u) << 16;
        var b = s.BuildingOn(t);
        if (b.Exists)
        {
            uint bh = (uint)b.Kind | (uint)b.Level << 4 | (uint)b.Look << 6 | (uint)s.BuildingAt[t] << 8;
            h ^= bh * 0x9E3779B1u;
        }

        return h;
    }

    private static T[] Share<T>(T[]? previous, T[] current)
        where T : unmanaged
    {
        if (previous is not null && previous.Length == current.Length
            && MemoryMarshal.AsBytes(previous.AsSpan()).SequenceEqual(MemoryMarshal.AsBytes(current.AsSpan())))
        {
            return previous;
        }

        return (T[])current.Clone();
    }
}
