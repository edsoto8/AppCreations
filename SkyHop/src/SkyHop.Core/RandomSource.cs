namespace SkyHop.Core;

/// <summary>Abstracts randomness so tests can force exact gap positions.</summary>
public interface IRandomSource
{
    /// <summary>Returns a value in [0, 1).</summary>
    double NextDouble();
}

public sealed class SystemRandomSource(int? seed = null) : IRandomSource
{
    private readonly Random _random = seed is null ? new Random() : new Random(seed.Value);

    public double NextDouble() => _random.NextDouble();
}
