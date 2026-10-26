namespace MetroSim.Core.World;

/// <summary>Inputs to terrain generation. The same settings always generate the same map.</summary>
public sealed record MapSettings
{
    public const int MinSize = 32;
    public const int MaxSize = 512;

    public int Width { get; init; } = 128;

    public int Height { get; init; } = 128;

    public ulong Seed { get; init; } = 1;

    /// <summary>Fraction of tiles below the water line (0..0.6).</summary>
    public double WaterCoverage { get; init; } = 0.16;

    /// <summary>Fraction of tiles that are unbuildable rock (0..0.4).</summary>
    public double RockCoverage { get; init; } = 0.06;

    /// <summary>Fraction of grass covered by trees (0..1).</summary>
    public double TreeCoverage { get; init; } = 0.3;

    public int Rivers { get; init; } = 1;

    /// <summary>Noise feature size in tiles. Larger means bigger continents and lakes.</summary>
    public double FeatureScale { get; init; } = 48;

    public void Validate()
    {
        if (Width < MinSize || Width > MaxSize || Height < MinSize || Height > MaxSize)
        {
            throw new ArgumentException($"Map size must be between {MinSize} and {MaxSize} tiles per side.");
        }

        if (WaterCoverage is < 0 or > 0.6 || RockCoverage is < 0 or > 0.4 || TreeCoverage is < 0 or > 1)
        {
            throw new ArgumentException("Coverage settings are out of range.");
        }

        if (Rivers is < 0 or > 8 || FeatureScale is < 4 or > 512)
        {
            throw new ArgumentException("River count or feature scale is out of range.");
        }
    }
}
