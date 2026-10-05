namespace SkyHop.Core;

/// <summary>Picks where each gap goes, keeping it inside the playable area and within reach of the previous one.</summary>
public static class GapGenerator
{
    public static (double Min, double Max) CenterBounds(GameConfig config, double gapSize)
    {
        var min = config.Obstacles.TopMargin + gapSize / 2;
        var max = config.World.GroundY - config.Obstacles.BottomMargin - gapSize / 2;
        if (min > max)
        {
            // The configured gap is too tall for the margins; center it rather than spawn an impossible pair.
            var middle = (config.Obstacles.TopMargin + config.World.GroundY - config.Obstacles.BottomMargin) / 2;
            return (middle, middle);
        }

        return (min, max);
    }

    public static double NextCenter(GameConfig config, double gapSize, double maxShift, double? previousCenter, double random01)
    {
        var (min, max) = CenterBounds(config, gapSize);
        var low = min;
        var high = max;

        if (previousCenter is double previous)
        {
            var anchor = Math.Clamp(previous, min, max);
            low = Math.Max(min, anchor - maxShift);
            high = Math.Min(max, anchor + maxShift);
        }

        return low + (high - low) * Math.Clamp(random01, 0, 1);
    }
}
