namespace SkyHop.Core;

/// <summary>Simple deterministic arcade physics: constant gravity, capped fall speed, instant flap.</summary>
public static class PlayerPhysics
{
    public const double FlapAnimationDuration = 0.25;
    private const double IdleWingRate = 7;
    private const double FlapWingRate = 26;

    /// <summary>Applies gravity and moves the player. Clamps to the ground and, when not lethal, to the ceiling.</summary>
    public static void Step(Player player, GameConfig config, double dt)
    {
        var p = config.Player;
        player.VelocityY = Math.Min(player.VelocityY + p.Gravity * dt, p.MaxFallVelocity);
        player.Y += player.VelocityY * dt;

        var floor = config.World.GroundY - p.HitboxRadius;
        player.OnGround = player.Y >= floor;
        if (player.OnGround)
        {
            player.Y = floor;
            player.VelocityY = 0;
        }

        if (!config.World.CeilingIsLethal && player.Y < p.HitboxRadius)
        {
            player.Y = p.HitboxRadius;
            player.VelocityY = Math.Max(player.VelocityY, 0);
        }

        UpdateRotation(player, p, dt);
        AnimateWings(player, dt);
    }

    public static double TargetRotation(PlayerConfig p, double velocityY)
    {
        if (velocityY < p.NoseDiveVelocity)
        {
            return p.MaxRiseRotation;
        }

        var t = Math.Clamp((velocityY - p.NoseDiveVelocity) / (p.MaxFallVelocity - p.NoseDiveVelocity), 0, 1);
        return p.MaxRiseRotation + (p.MaxFallRotation - p.MaxRiseRotation) * t;
    }

    public static void UpdateRotation(Player player, PlayerConfig p, double dt)
    {
        var target = TargetRotation(p, player.VelocityY);
        var speed = target < player.Rotation ? p.RiseRotationSpeed : p.FallRotationSpeed;
        player.Rotation = MoveTowards(player.Rotation, target, speed * dt);
    }

    public static void AnimateWings(Player player, double dt)
    {
        var rate = player.FlapTimer > 0 ? FlapWingRate : IdleWingRate;
        player.FlapTimer = Math.Max(0, player.FlapTimer - dt);
        player.WingPhase = (player.WingPhase + rate * dt) % (Math.PI * 2);
    }

    public static double MoveTowards(double current, double target, double maxDelta) =>
        Math.Abs(target - current) <= maxDelta ? target : current + Math.Sign(target - current) * maxDelta;
}
