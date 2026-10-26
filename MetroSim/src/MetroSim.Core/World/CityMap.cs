namespace MetroSim.Core.World;

/// <summary>
/// The tile grid. Each layer is a flat array indexed by <c>y * Width + x</c>. Terrain layers are
/// produced by <see cref="TerrainGenerator"/>; the rest are edited by commands and simulation systems.
/// </summary>
public sealed class CityMap
{
    public CityMap(int width, int height)
    {
        Width = width;
        Height = height;
        int n = width * height;
        Elevation = new byte[n];
        Terrain = new TerrainType[n];
        Trees = new byte[n];
        Roads = new RoadType[n];
        Zones = new ZoneType[n];
        BuildingAt = new int[n];
        PowerLines = new bool[n];
        Pollution = new byte[n];
        LandValue = new byte[n];
    }

    public int Width { get; }

    public int Height { get; }

    public int TileCount => Width * Height;

    public byte[] Elevation { get; }

    public TerrainType[] Terrain { get; }

    /// <summary>Tree density 0..3 (vegetation).</summary>
    public byte[] Trees { get; }

    public RoadType[] Roads { get; }

    public ZoneType[] Zones { get; }

    /// <summary>Building id occupying the tile, 0 when empty.</summary>
    public int[] BuildingAt { get; }

    public bool[] PowerLines { get; }

    /// <summary>0..255, recomputed hourly.</summary>
    public byte[] Pollution { get; }

    /// <summary>0..255, recomputed hourly.</summary>
    public byte[] LandValue { get; }

    /// <summary>Bumped whenever roads, zones, buildings, trees or power lines change. Not saved; render cache key.</summary>
    public int Version { get; private set; }

    /// <summary>Bumped when terrain types or elevation change (generation and loading). Not saved; render cache key.</summary>
    public int TerrainVersion { get; private set; }

    public int Index(int x, int y) => y * Width + x;

    public int X(int index) => index % Width;

    public int Y(int index) => index / Width;

    public bool InBounds(int x, int y) => (uint)x < (uint)Width && (uint)y < (uint)Height;

    public bool IsWater(int index) => Terrain[index] == TerrainType.Water;

    /// <summary>Land that can hold zones and buildings: sand or grass, no road, no power line.</summary>
    public bool IsBuildableLand(int index) =>
        Terrain[index] is TerrainType.Grass or TerrainType.Sand && Roads[index] == RoadType.None && !PowerLines[index];

    /// <summary>Bumped when roads change. Not saved; road-graph cache key.</summary>
    public int RoadVersion { get; private set; }

    public void Touch() => Version++;

    public void TouchRoads()
    {
        RoadVersion++;
        Version++;
    }

    public void TouchTerrain()
    {
        TerrainVersion++;
        Version++;
    }

    /// <summary>The 4-neighbour of <paramref name="index"/> in <paramref name="direction"/>, or -1 off the map.</summary>
    public int Neighbor(int index, int direction)
    {
        int x = index % Width + Mathematics.Directions.Dx[direction];
        int y = index / Width + Mathematics.Directions.Dy[direction];
        return InBounds(x, y) ? y * Width + x : -1;
    }
}
