namespace SkyHop.Core;

/// <summary>
/// Every gameplay tuning value lives here. Units are world units (a fixed 360 x 640 portrait
/// world that the renderer scales to the screen) and seconds. Because the world size is fixed,
/// the screen size never changes difficulty.
/// </summary>
public sealed record GameConfig
{
    public static GameConfig Default { get; } = new();

    public WorldConfig World { get; init; } = new();
    public PlayerConfig Player { get; init; } = new();
    public ObstacleConfig Obstacles { get; init; } = new();
    public DifficultyConfig Difficulty { get; init; } = new();
    public TimingConfig Timing { get; init; } = new();
}

public sealed record WorldConfig
{
    public double Width { get; init; } = 360;
    public double Height { get; init; } = 640;
    public double GroundHeight { get; init; } = 100;

    /// <summary>
    /// When false the top of the screen is a soft ceiling: the player is held under it instead of dying.
    /// Obstacles reach past the top, so the ceiling can never be used to skip one.
    /// </summary>
    public bool CeilingIsLethal { get; init; } = false;

    /// <summary>Y coordinate of the top of the ground (y grows downward).</summary>
    public double GroundY => Height - GroundHeight;
}

public sealed record PlayerConfig
{
    public double X { get; init; } = 110;
    public double StartY { get; init; } = 290;

    /// <summary>Downward acceleration in units/s².</summary>
    public double Gravity { get; init; } = 1300;

    /// <summary>Vertical velocity set by a flap (negative is up).</summary>
    public double FlapVelocity { get; init; } = -390;

    public double MaxFallVelocity { get; init; } = 560;

    /// <summary>Radius of the drawn body. The hitbox is deliberately smaller.</summary>
    public double VisualRadius { get; init; } = 17;
    public double HitboxRadius { get; init; } = 12.5;

    /// <summary>Nose-up angle (degrees) while rising.</summary>
    public double MaxRiseRotation { get; init; } = -25;

    /// <summary>Nose-down angle (degrees) at terminal fall speed.</summary>
    public double MaxFallRotation { get; init; } = 90;

    /// <summary>Fall speed below which the player keeps its nose up after a flap.</summary>
    public double NoseDiveVelocity { get; init; } = 180;

    public double RiseRotationSpeed { get; init; } = 720;
    public double FallRotationSpeed { get; init; } = 330;

    public double IdleBobAmplitude { get; init; } = 8;
    public double IdleBobFrequency { get; init; } = 1.6;
}

public sealed record ObstacleConfig
{
    public double Width { get; init; } = 64;

    /// <summary>Horizontal hitbox shrink on each side, so grazing the edge is forgiven.</summary>
    public double HitboxInset { get; init; } = 3;

    /// <summary>X position (left edge) of the very first obstacle after the game starts.</summary>
    public double FirstSpawnX { get; init; } = 440;

    /// <summary>Obstacles are created at this X when the previous one has moved far enough left.</summary>
    public double SpawnX { get; init; } = 380;

    /// <summary>
    /// Smallest allowed distance between the top of the world and the top of a gap
    /// (this bounds the highest possible gap).
    /// </summary>
    public double TopMargin { get; init; } = 70;

    /// <summary>
    /// Smallest allowed distance between the bottom of a gap and the ground
    /// (this bounds the lowest possible gap).
    /// </summary>
    public double BottomMargin { get; init; } = 60;
}

/// <summary>
/// Difficulty is a pure function of score, in three tiers:
/// Beginner (0..BeginnerMaxScore) is constant; Moderate ramps a little per point;
/// Advanced keeps ramping more slowly until every value reaches its limit.
/// </summary>
public sealed record DifficultyConfig
{
    public int BeginnerMaxScore { get; init; } = 10;
    public int ModerateMaxScore { get; init; } = 25;

    public double BaseSpeed { get; init; } = 140;
    public double MaxSpeed { get; init; } = 220;
    public double ModerateSpeedIncreasePerPoint { get; init; } = 2.0;
    public double AdvancedSpeedIncreasePerPoint { get; init; } = 1.0;

    /// <summary>How quickly the actual scroll speed eases toward the target speed (units/s per second).</summary>
    public double SpeedEasing { get; init; } = 12;

    public double BaseGapSize { get; init; } = 170;
    public double MinGapSize { get; init; } = 136;
    public double GapShrinkPerPoint { get; init; } = 0.8;

    /// <summary>Horizontal distance between consecutive obstacle pairs.</summary>
    public double BaseSpacing { get; init; } = 230;
    public double MinSpacing { get; init; } = 205;
    public double SpacingShrinkPerPoint { get; init; } = 0.5;

    /// <summary>
    /// Largest vertical move of the gap center between consecutive pairs. Keeping the limit below
    /// <see cref="MinGapSize"/> means neighbouring gaps always overlap, so no pattern needs a perfect dive.
    /// </summary>
    public double BaseMaxGapShift { get; init; } = 95;
    public double MaxGapShiftLimit { get; init; } = 115;
    public double GapShiftGrowthPerPoint { get; init; } = 1.2;
}

public sealed record TimingConfig
{
    /// <summary>Simulation step. A fixed step keeps physics deterministic regardless of frame rate.</summary>
    public double FixedStep { get; init; } = 1.0 / 120.0;

    /// <summary>Longest frame the game will simulate; longer hitches are dropped rather than replayed.</summary>
    public double MaxFrameDelta { get; init; } = 0.1;

    /// <summary>Minimum length of the death animation before the Game Over panel appears.</summary>
    public double DeathMinDuration { get; init; } = 0.55;

    /// <summary>The death animation ends after this long even if the player has not landed yet.</summary>
    public double DeathMaxDuration { get; init; } = 1.6;

    /// <summary>Flap input is ignored this long after Game Over, so a panicked tap does not instantly restart.</summary>
    public double RestartLockDuration { get; init; } = 0.6;
}
