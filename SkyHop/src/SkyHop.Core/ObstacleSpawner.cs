namespace SkyHop.Core;

/// <summary>
/// Moves, spawns and recycles obstacle pairs. Pairs are pooled, so a long session allocates nothing
/// after the first few spawns. Spawning is distance-based: each new pair is placed exactly
/// <c>spacing</c> units after the previous one, whatever the speed or frame rate.
/// </summary>
public sealed class ObstacleSpawner(GameConfig config, IRandomSource random)
{
    private readonly List<ObstaclePair> _active = [];
    private readonly Stack<ObstaclePair> _pool = new();
    private int _nextId;
    private double? _lastGapCenter;

    /// <summary>Active pairs ordered left to right.</summary>
    public IReadOnlyList<ObstaclePair> Active => _active;

    /// <summary>Total pairs ever created (active + pooled). Stays small however long the game runs.</summary>
    public int AllocatedCount { get; private set; }

    public void Reset()
    {
        foreach (var pair in _active)
        {
            _pool.Push(pair);
        }

        _active.Clear();
        _lastGapCenter = null;
    }

    public void Update(double dt, double speed, DifficultySnapshot difficulty)
    {
        var dx = speed * dt;
        foreach (var pair in _active)
        {
            pair.X -= dx;
        }

        // Pairs only ever leave from the left, so the first one is always the oldest.
        while (_active.Count > 0 && _active[0].Right < 0)
        {
            _pool.Push(_active[0]);
            _active.RemoveAt(0);
        }

        if (_active.Count == 0)
        {
            Spawn(config.Obstacles.FirstSpawnX, difficulty);
        }

        // Loop so a long frame cannot leave a hole in the obstacle sequence.
        while (_active[^1].X + difficulty.Spacing <= config.Obstacles.SpawnX)
        {
            Spawn(_active[^1].X + difficulty.Spacing, difficulty);
        }
    }

    private void Spawn(double x, DifficultySnapshot difficulty)
    {
        var center = GapGenerator.NextCenter(config, difficulty.GapSize, difficulty.MaxGapShift, _lastGapCenter, random.NextDouble());
        _lastGapCenter = center;

        if (!_pool.TryPop(out var pair))
        {
            pair = new ObstaclePair();
            AllocatedCount++;
        }

        pair.Spawn(++_nextId, x, config.Obstacles.Width, center, difficulty.GapSize);
        _active.Add(pair);
    }
}
