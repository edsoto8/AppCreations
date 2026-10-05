namespace SkyHop.Core;

public readonly record struct DifficultySnapshot(
    int Level,
    string LevelName,
    double Speed,
    double GapSize,
    double Spacing,
    double MaxGapShift);

/// <summary>Turns the current score into obstacle speed, gap size, spacing and gap variation.</summary>
public sealed class DifficultyManager(DifficultyConfig config)
{
    public DifficultySnapshot Evaluate(int score)
    {
        var level = score <= config.BeginnerMaxScore ? 1 : score <= config.ModerateMaxScore ? 2 : 3;
        var name = level switch { 1 => "Beginner", 2 => "Moderate", _ => "Advanced" };

        // Points scored past each tier boundary.
        var moderatePoints = Math.Clamp(score - config.BeginnerMaxScore, 0, config.ModerateMaxScore - config.BeginnerMaxScore);
        var advancedPoints = Math.Max(0, score - config.ModerateMaxScore);
        var pointsPastBeginner = Math.Max(0, score - config.BeginnerMaxScore);

        var speed = config.BaseSpeed
            + moderatePoints * config.ModerateSpeedIncreasePerPoint
            + advancedPoints * config.AdvancedSpeedIncreasePerPoint;

        var gap = config.BaseGapSize - pointsPastBeginner * config.GapShrinkPerPoint;
        var spacing = config.BaseSpacing - pointsPastBeginner * config.SpacingShrinkPerPoint;
        var shift = config.BaseMaxGapShift + pointsPastBeginner * config.GapShiftGrowthPerPoint;

        return new DifficultySnapshot(
            level,
            name,
            Math.Min(speed, config.MaxSpeed),
            Math.Max(gap, config.MinGapSize),
            Math.Max(spacing, config.MinSpacing),
            Math.Min(shift, config.MaxGapShiftLimit));
    }
}
