using MetroSim.Core.World;

namespace MetroSim.Core.Roads;

/// <summary>
/// Breadth-first search over road tiles with reusable, generation-stamped buffers. Visits tiles in
/// non-decreasing road distance; ties follow source order then N/E/S/W, so the order is deterministic.
/// </summary>
public sealed class RoadSearch
{
    private readonly CityMap _map;
    private readonly int[] _stamp;
    private readonly int[] _distance;
    private readonly int[] _queue;
    private int _generation;

    public RoadSearch(CityMap map)
    {
        _map = map;
        _stamp = new int[map.TileCount];
        _distance = new int[map.TileCount];
        _queue = new int[map.TileCount];
    }

    /// <summary>Number of tiles reached by the last search, in visit order via <see cref="Visited"/>.</summary>
    public int VisitedCount { get; private set; }

    public int Visited(int order) => _queue[order];

    public int DistanceOf(int tile) => _stamp[tile] == _generation ? _distance[tile] : -1;

    public void Run(ReadOnlySpan<int> sources, int maxDistance)
    {
        _generation++;
        if (_generation == int.MaxValue)
        {
            Array.Clear(_stamp);
            _generation = 1;
        }

        int head = 0;
        int tail = 0;
        foreach (int s in sources)
        {
            if (s >= 0 && _map.Roads[s] != RoadType.None && _stamp[s] != _generation)
            {
                _stamp[s] = _generation;
                _distance[s] = 0;
                _queue[tail++] = s;
            }
        }

        while (head < tail)
        {
            int t = _queue[head++];
            int dist = _distance[t];
            if (dist >= maxDistance)
            {
                continue;
            }

            for (int d = 0; d < 4; d++)
            {
                int nb = _map.Neighbor(t, d);
                if (nb >= 0 && _map.Roads[nb] != RoadType.None && _stamp[nb] != _generation)
                {
                    _stamp[nb] = _generation;
                    _distance[nb] = dist + 1;
                    _queue[tail++] = nb;
                }
            }
        }

        VisitedCount = tail;
    }

    public void Run(int source, int maxDistance) => Run([source], maxDistance);
}
