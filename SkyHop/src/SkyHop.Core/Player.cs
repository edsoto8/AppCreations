namespace SkyHop.Core;

public sealed class Player
{
    public double X { get; internal set; }
    public double Y { get; internal set; }

    /// <summary>Vertical velocity in units/s; negative is up.</summary>
    public double VelocityY { get; internal set; }

    /// <summary>Body angle in degrees; negative is nose-up.</summary>
    public double Rotation { get; internal set; }

    /// <summary>Wing animation phase in radians. Advances faster for a moment after each flap.</summary>
    public double WingPhase { get; internal set; }

    /// <summary>Seconds left of the fast "just flapped" wing beat.</summary>
    public double FlapTimer { get; internal set; }

    public bool OnGround { get; internal set; }

    public void Reset(PlayerConfig config)
    {
        X = config.X;
        Y = config.StartY;
        VelocityY = 0;
        Rotation = 0;
        WingPhase = 0;
        FlapTimer = 0;
        OnGround = false;
    }

    public void Flap(PlayerConfig config)
    {
        VelocityY = config.FlapVelocity;
        FlapTimer = PlayerPhysics.FlapAnimationDuration;
    }
}
