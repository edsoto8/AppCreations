using System.Diagnostics;
using MetroSim.Core.Mathematics;
using MetroSim.Core.World;

namespace MetroSim.Core.Roads;

/// <summary>Cost of entering and crossing a road tile while travelling in a direction, in milli-ticks.</summary>
public interface IRoadCostModel
{
    int EntryCost(int tile, Direction travel);

    /// <summary>Lower bound of <see cref="EntryCost"/> for any tile (keeps A* admissible).</summary>
    int MinimumEntryCost { get; }
}

/// <summary>
/// A* over road tiles. Buffers are allocated once and invalidated with a generation stamp, so a search
/// costs only the nodes it expands. Deterministic: heap ties break by insertion order.
/// </summary>
public sealed class Pathfinder
{
    private readonly CityMap _map;
    private readonly int[] _stamp;
    private readonly int[] _cost;
    private readonly int[] _cameFrom;
    private readonly bool[] _closed;
    private readonly MinHeap _open = new();
    private readonly List<int> _scratch = [];
    private int _generation;

    public Pathfinder(CityMap map)
    {
        _map = map;
        int n = map.TileCount;
        _stamp = new int[n];
        _cost = new int[n];
        _cameFrom = new int[n];
        _closed = new bool[n];
    }

    /// <summary>Searches run so far (performance metric, not simulation state).</summary>
    public long Searches { get; private set; }

    public long NodesExpanded { get; private set; }

    public long ElapsedTicks { get; private set; }

    /// <summary>Upper bound on expanded nodes per search; protects tick time on huge maps.</summary>
    public int NodeLimit { get; set; } = 60_000;

    /// <summary>
    /// Heuristic weight in percent. 100 is plain (optimal) A*; above 100 is weighted A*, which expands far
    /// fewer nodes and returns routes at most that much costlier than the best (a realistic driver).
    /// Default 125: on the 60-day growing demo city it expands a third fewer nodes than plain A* with
    /// unchanged congestion and commute times, while a 25% faster avenue detour still always wins
    /// (150 was faster still but ignored such detours). See docs/BENCHMARKS.md. Not saved; changing it
    /// changes simulation results.
    /// </summary>
    public int HeuristicWeightPercent { get; set; } = 125;

    /// <summary>
    /// Finds the cheapest road path from <paramref name="start"/> to <paramref name="goal"/>, both road
    /// tiles. Returns null when unreachable. The result includes both endpoints.
    /// </summary>
    public int[]? FindPath(int start, int goal, IRoadCostModel costs, out int totalCost)
    {
        long began = Stopwatch.GetTimestamp();
        totalCost = 0;
        Searches++;
        try
        {
            if (start < 0 || goal < 0 || _map.Roads[start] == RoadType.None || _map.Roads[goal] == RoadType.None)
            {
                return null;
            }

            if (start == goal)
            {
                return [start];
            }

            NextGeneration();
            int w = _map.Width;
            int gx = goal % w;
            int gy = goal / w;
            int hScale = costs.MinimumEntryCost * HeuristicWeightPercent / 100;
            _open.Clear();
            Touch(start, 0, -1);
            _open.Push(Key(0, Heuristic(start, gx, gy, w, hScale)), start);
            int expanded = 0;
            while (_open.Count > 0)
            {
                int current = _open.Pop(out _);
                if (_closed[current])
                {
                    continue;
                }

                if (current == goal)
                {
                    NodesExpanded += expanded;
                    totalCost = _cost[goal];
                    return Reconstruct(goal);
                }

                _closed[current] = true;
                if (++expanded > NodeLimit)
                {
                    break;
                }

                int baseCost = _cost[current];
                for (int d = 0; d < 4; d++)
                {
                    int nb = _map.Neighbor(current, d);
                    if (nb < 0 || _map.Roads[nb] == RoadType.None)
                    {
                        continue;
                    }

                    if (_stamp[nb] == _generation && _closed[nb])
                    {
                        continue;
                    }

                    int newCost = baseCost + costs.EntryCost(nb, (Direction)d);
                    if (_stamp[nb] != _generation || newCost < _cost[nb])
                    {
                        Touch(nb, newCost, current);
                        _open.Push(Key(newCost, Heuristic(nb, gx, gy, w, hScale)), nb);
                    }
                }
            }

            NodesExpanded += expanded;
            return null;
        }
        finally
        {
            ElapsedTicks += Stopwatch.GetTimestamp() - began;
        }
    }

    /// <summary>Orders by f = g + h, then by smaller h: among equally promising nodes, the one nearest the goal.</summary>
    private static long Key(int g, int h) => ((long)(g + h) << 31) | (uint)h;

    private static int Heuristic(int tile, int gx, int gy, int width, int scale) =>
        (Math.Abs(tile % width - gx) + Math.Abs(tile / width - gy)) * scale;

    private void Touch(int tile, int cost, int from)
    {
        if (_stamp[tile] != _generation)
        {
            _stamp[tile] = _generation;
            _closed[tile] = false;
        }

        _cost[tile] = cost;
        _cameFrom[tile] = from;
    }

    private void NextGeneration()
    {
        _generation++;
        if (_generation == int.MaxValue)
        {
            Array.Clear(_stamp);
            _generation = 1;
        }
    }

    private int[] Reconstruct(int goal)
    {
        _scratch.Clear();
        for (int t = goal; t >= 0; t = _cameFrom[t])
        {
            _scratch.Add(t);
        }

        _scratch.Reverse();
        return [.. _scratch];
    }
}
