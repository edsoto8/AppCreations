using SkyHop.Core;

namespace SkyHop.Tests;

public class PhysicsTests
{
    private static readonly GameConfig Config = GameConfig.Default;

    [Fact]
    public void Gravity_IsCappedAtMaxFallVelocity()
    {
        var player = new Player();
        player.Reset(Config.Player);

        for (var i = 0; i < 240; i++)
        {
            PlayerPhysics.Step(player, Config, 1.0 / 120);
        }

        Assert.True(player.VelocityY <= Config.Player.MaxFallVelocity);
    }

    [Fact]
    public void Physics_IsDeterministic()
    {
        static double Simulate()
        {
            var game = TestSupport.CreateGame();
            game.Handle(InputAction.Flap);
            for (var i = 0; i < 90; i++)
            {
                if (i % 30 == 0)
                {
                    game.Handle(InputAction.Flap);
                }

                game.Step(1.0 / 120);
            }

            return game.Player.Y;
        }

        Assert.Equal(Simulate(), Simulate());
    }

    [Fact]
    public void Update_UsesFixedStepsRegardlessOfFrameRate()
    {
        var at60 = TestSupport.CreateGame();
        var at30 = TestSupport.CreateGame();
        at60.Handle(InputAction.Flap);
        at30.Handle(InputAction.Flap);

        for (var i = 0; i < 30; i++)
        {
            at60.Update(1.0 / 60);
        }

        for (var i = 0; i < 15; i++)
        {
            at30.Update(1.0 / 30);
        }

        Assert.Equal(at60.Player.Y, at30.Player.Y, 6);
    }

    [Fact]
    public void Rotation_TiltsUpWhenRisingAndDownWhenFalling()
    {
        var player = new Player();
        player.Reset(Config.Player);
        player.Flap(Config.Player);

        for (var i = 0; i < 6; i++)
        {
            PlayerPhysics.Step(player, Config, 1.0 / 120);
        }

        Assert.True(player.Rotation < 0);

        for (var i = 0; i < 120; i++)
        {
            PlayerPhysics.Step(player, Config, 1.0 / 120);
        }

        Assert.True(player.Rotation > 45);
    }

    [Fact]
    public void Ceiling_HoldsPlayerWhenNotLethal()
    {
        var player = new Player();
        player.Reset(Config.Player);
        player.Y = 5;
        player.VelocityY = Config.Player.FlapVelocity;

        PlayerPhysics.Step(player, Config, 1.0 / 120);

        Assert.Equal(Config.Player.HitboxRadius, player.Y);
        Assert.True(player.VelocityY >= 0);
    }

    [Fact]
    public void Ceiling_EndsGameWhenLethal()
    {
        var config = GameConfig.Default with { World = GameConfig.Default.World with { CeilingIsLethal = true } };
        var game = TestSupport.CreateGame(config);
        game.Handle(InputAction.Flap);

        TestSupport.RunUntil(game, g => g.State != GameState.Playing, 5, g =>
        {
            if (g.Player.VelocityY > 0)
            {
                g.Handle(InputAction.Flap);
            }
        });

        Assert.Equal(GameEvent.HitBoundary, game.DeathCause);
    }

    [Theory]
    [InlineData(50, 50, 10, true)]
    [InlineData(29, 50, 10, false)]
    [InlineData(39, 50, 10, true)]
    [InlineData(45, 45, 7, true)]
    [InlineData(34, 34, 7, false)]
    public void CircleRect_DetectsOverlap(double cx, double cy, double r, bool expected)
    {
        var rect = new Rect(40, 40, 20, 20);

        Assert.Equal(expected, Collision.CircleIntersectsRect(cx, cy, r, rect));
    }
}
