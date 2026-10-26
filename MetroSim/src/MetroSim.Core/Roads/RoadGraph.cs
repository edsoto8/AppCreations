using MetroSim.Core.World;

namespace MetroSim.Core.Roads;

/// <summary>
/// Data derived from the road layer: connected components and intersections. Rebuilt lazily whenever
/// <see cref="CityMap.RoadVersion"/> changes, so it is always a pure function of the saved road tiles.
/// </summary>
public sealed class RoadGraph
{
    private readonly CityMap _map;
    private readonly int[] _component;
    private readonly bool[] _intersection;
    private readonly int[] _queue;
    private int _builtVersion = -1;
    private int _avenueTiles;
    private int _roadTiles;
    private int _componentCount;

    public RoadGraph(CityMap map)
    {
        _map = map;
        _component = new int[map.TileCount];
        _intersection = new bool[map.TileCount];
        _queue = new int[map.TileCount];
    }

    public int RoadTiles
    {
        get
        {
            EnsureBuilt();
            return _roadTiles;
        }
    }

    public int AvenueTiles
    {
        get
        {
            EnsureBuilt();
            return _avenueTiles;
        }
    }

    public int ComponentCount
    {
        get
        {
            EnsureBuilt();
            return _componentCount;
        }
    }

    public bool IsRoad(int tile) => tile >= 0 && _map.Roads[tile] != RoadType.None;

    /// <summary>Connected-component label of a road tile (1-based), or 0 for non-road tiles.</summary>
    public int ComponentOf(int tile)
    {
        EnsureBuilt();
        return tile >= 0 ? _component[tile] : 0;
    }

    public bool Connected(int a, int b)
    {
        int ca = ComponentOf(a);
        return ca != 0 && ca == ComponentOf(b);
    }

    public bool IsIntersection(int tile)
    {
        EnsureBuilt();
        return _intersection[tile];
    }

    public int RoadNeighbourCount(int tile)
    {
        int count = 0;
        for (int d = 0; d < 4; d++)
        {
            if (IsRoad(_map.Neighbor(tile, d)))
            {
                count++;
            }
        }

        return count;
    }

    private void EnsureBuilt()
    {
        if (_builtVersion == _map.RoadVersion)
        {
            return;
        }

        _builtVersion = _map.RoadVersion;
        Array.Clear(_component);
        _roadTiles = 0;
        _avenueTiles = 0;
        int label = 0;
        for (int i = 0; i < _map.TileCount; i++)
        {
            var road = _map.Roads[i];
            if (road == RoadType.None)
            {
                _intersection[i] = false;
                continue;
            }

            _roadTiles++;
            if (road == RoadType.Avenue)
            {
                _avenueTiles++;
            }

            _intersection[i] = RoadNeighbourCount(i) >= 3;
            if (_component[i] != 0)
            {
                continue;
            }

            label++;
            int head = 0;
            int tail = 0;
            _queue[tail++] = i;
            _component[i] = label;
            while (head < tail)
            {
                int t = _queue[head++];
                for (int d = 0; d < 4; d++)
                {
                    int nb = _map.Neighbor(t, d);
                    if (nb >= 0 && _map.Roads[nb] != RoadType.None && _component[nb] == 0)
                    {
                        _component[nb] = label;
                        _queue[tail++] = nb;
                    }
                }
            }
        }

        _componentCount = label;
    }
}
