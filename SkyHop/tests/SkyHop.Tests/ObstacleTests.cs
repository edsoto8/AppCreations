using SkyHop.Core;

namespace SkyHop.Tests;

public class ObstacleTests
{
    private static readonly GameConfig Config = GameConfig.Default;

    [Theory]
    [InlineData(0.0)]
    [InlineData(0.5)]
    [InlineData(0.999999)]
    public void FirstGap_StaysInsidePlayableArea(double random)
    {
        foreach (var gap in new[] { Config.Difficulty.BaseGapSize, Config.Difficulty.MinGapSize })
        {
            var center = GapGenerator.NextCenter(Config, gap, 50, previousCenter: null, random);

            Assert.True(center - gap / 2 >= Config.Obstacles.TopMargin);
            Assert.True(center + gap / 2 <= Config.World.GroundY - Config.Obstacles.BottomMargin);
        }
    }

    [Fact]
    public void RandomGaps_AlwaysValidAndWithinShiftOfPrevious()
    {
        var random = new SystemRandomSource(1234);
        var difficulty = new DifficultyManager(Config.Difficulty);
        double? previous = null;

        for (var i = 0; i < 20_000; i++)
        {
            // Score only rises during a run, so the gap only ever shrinks.
            var d = difficulty.Evaluate(i / 150);
            var center = GapGenerator.NextCenter(Config, d.GapSize, d.MaxGapShift, previous, random.NextDouble());

            Assert.True(center - d.GapSize / 2 >= Config.Obstacles.TopMargin - 1e-9);
            Assert.True(center + d.GapSize / 2 <= Config.World.GroundY - Config.Obstacles.BottomMargin + 1e-9);
            if (previous is double p)
            {
                Assert.True(Math.Abs(center - p) <= d.MaxGapShift + 1e-9);
            }

            previous = center;
        }
    }

    [Fact]
    public void OversizedGap_IsCenteredInsteadOfImpossible()
    {
        var center = GapGenerator.NextCenter(Config, gapSize: 5000, maxShift: 100, previousCenter: null, random01: 0.9);
        var expected = (Config.Obstacles.TopMargin + Config.World.GroundY - Config.Obstacles.BottomMargin) / 2;

        Assert.Equal(expected, center, 6);
    }

    [Fact]
    public void Spawner_SpawnsOffscreenAtExactSpacing()
    {
        var spawner = new ObstacleSpawner(Config, new FixedRandom(0.3));
        var difficulty = new DifficultyManager(Config.Difficulty).Evaluate(0);
        var seen = new HashSet<int>();

        for (var i = 0; i < 600; i++)
        {
            spawner.Update(1.0 / 120, difficulty.Speed, difficulty);
            var newest = spawner.Active[^1];
            if (seen.Add(newest.Id))
            {
                Assert.True(newest.X > Config.World.Width, "New pairs should spawn beyond the right edge");
            }
        }

        var active = spawner.Active;
        Assert.True(seen.Count >= 3);
        Assert.True(active.Count >= 2);
        for (var i = 1; i < active.Count; i++)
        {
            Assert.Equal(difficulty.Spacing, active[i].X - active[i - 1].X, 6);
        }
    }

    [Fact]
    public void Spawner_RecyclesPairsSoLongSessionsDoNotAllocate()
    {
        var spawner = new ObstacleSpawner(Config, new SystemRandomSource(7));
        var difficulty = new DifficultyManager(Config.Difficulty);
        var ids = new HashSet<int>();

        // Ten simulated minutes at the fastest speed.
        for (var i = 0; i < 120 * 600; i++)
        {
            var d = difficulty.Evaluate(1000);
            spawner.Update(1.0 / 120, d.Speed, d);
            foreach (var pair in spawner.Active)
            {
                ids.Add(pair.Id);
            }
        }

        Assert.True(ids.Count > 300, $"Expected hundreds of pairs, saw {ids.Count}");
        Assert.InRange(spawner.AllocatedCount, 1, 6);
        Assert.All(spawner.Active, p => Assert.True(p.Right >= 0));
    }

    [Fact]
    public void Spawner_LongFrame_LeavesNoHoles()
    {
        var spawner = new ObstacleSpawner(Config, new FixedRandom(0.5));
        var d = new DifficultyManager(Config.Difficulty).Evaluate(0);

        spawner.Update(0.01, d.Speed, d);
        spawner.Update(5, d.Speed, d);

        var active = spawner.Active;
        for (var i = 1; i < active.Count; i++)
        {
            Assert.Equal(d.Spacing, active[i].X - active[i - 1].X, 6);
        }
    }

    [Fact]
    public void Reset_ReturnsPairsToPool()
    {
        var spawner = new ObstacleSpawner(Config, new FixedRandom(0.5));
        var d = new DifficultyManager(Config.Difficulty).Evaluate(0);
        for (var i = 0; i < 400; i++)
        {
            spawner.Update(1.0 / 120, d.Speed, d);
        }

        var allocated = spawner.AllocatedCount;
        spawner.Reset();
        Assert.Empty(spawner.Active);

        for (var i = 0; i < 400; i++)
        {
            spawner.Update(1.0 / 120, d.Speed, d);
        }

        Assert.Equal(allocated, spawner.AllocatedCount);
    }
}
