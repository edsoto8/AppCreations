using SkyHop.Core;

namespace SkyHop.Tests;

/// <summary>Returns the same value every time, so gap positions are predictable.</summary>
internal sealed class FixedRandom(double value) : IRandomSource
{
    public double NextDouble() => value;
}

internal static class TestSupport
{
    public static Game CreateGame(GameConfig? config = null, IHighScoreStore? store = null, IRandomSource? random = null) =>
        new(config ?? GameConfig.Default, store ?? new InMemoryHighScoreStore(), random ?? new FixedRandom(0.5));

    /// <summary>Runs fixed steps until the predicate holds or the time budget runs out.</summary>
    public static bool RunUntil(Game game, Func<Game, bool> predicate, double maxSeconds, Action<Game>? eachStep = null)
    {
        var step = game.Config.Timing.FixedStep;
        for (double t = 0; t < maxSeconds; t += step)
        {
            eachStep?.Invoke(game);
            game.Step(step);
            if (predicate(game))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Pins the player to the center of the next gap, so the world can scroll past without a collision.</summary>
    public static void HoldInGap(Game game)
    {
        var target = game.Obstacles.Active.FirstOrDefault(p => p.Right > game.Player.X)?.GapCenter ?? game.Config.Player.StartY;
        game.Player.Y = target;
        game.Player.VelocityY = 0;
    }

    /// <summary>
    /// A simple bot that plays like a careful human: flaps whenever it sinks below a target line.
    /// Between columns it aims a little below the next gap's center; inside a column it hugs the side
    /// of the current gap nearest the following gap. Used to prove generated levels are passable.
    /// </summary>
    public static void Autopilot(Game game)
    {
        if (game.State != GameState.Playing)
        {
            return;
        }

        var player = game.Player;
        var radius = game.Config.Player.HitboxRadius;
        var active = game.Obstacles.Active;
        var index = -1;
        for (var i = 0; i < active.Count; i++)
        {
            if (active[i].Right + radius > player.X)
            {
                index = i;
                break;
            }
        }

        double target;
        if (index < 0)
        {
            target = game.Config.Player.StartY;
        }
        else
        {
            var current = active[index];
            var following = index + 1 < active.Count ? active[index + 1] : null;
            var inside = player.X + radius > current.X;
            target = inside && following is not null
                ? following.GapCenter > current.GapCenter ? current.GapBottom - 18 : current.GapTop + 75
                : current.GapCenter + current.GapSize * 0.22;
        }

        if (player.Y > target && player.VelocityY > 0)
        {
            game.Handle(InputAction.Flap);
        }
    }
}
