namespace MetroSim.Core.Engine;

/// <summary>
/// Buildings grouped by access road tile (singly linked lists in id order), rebuilt on demand. Lets
/// road searches hand out services to buildings in road-distance order.
/// </summary>
internal sealed class BuildingIndex
{
    private readonly Simulation _sim;
    private int[] _head;
    private int[] _next = new int[64];

    public BuildingIndex(Simulation sim)
    {
        _sim = sim;
        _head = new int[sim.Map.TileCount];
    }

    public void Rebuild()
    {
        Array.Clear(_head);
        var buildings = _sim.Buildings;
        if (_next.Length < buildings.HighWater)
        {
            _next = new int[Math.Max(buildings.HighWater, _next.Length * 2)];
        }

        // Insert in descending id order so each list ends up ascending.
        for (int id = buildings.HighWater - 1; id >= 1; id--)
        {
            var b = buildings[id];
            if (b is null || b.AccessTile < 0)
            {
                continue;
            }

            _next[id] = _head[b.AccessTile];
            _head[b.AccessTile] = id;
        }
    }

    /// <summary>First building id served from <paramref name="tile"/>, 0 when none.</summary>
    public int First(int tile) => _head[tile];

    public int Next(int buildingId) => _next[buildingId];
}
