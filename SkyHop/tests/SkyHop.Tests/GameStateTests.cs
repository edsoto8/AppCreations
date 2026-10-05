using SkyHop.Core;

namespace SkyHop.Tests;

public class GameStateTests
{
    [Fact]
    public void NewGame_WaitsOnStartScreen()
    {
        var game = TestSupport.CreateGame();
        var startY = game.Player.Y;

        TestSupport.RunUntil(game, _ => false, maxSeconds: 3);

        Assert.Equal(GameState.Start, game.State);
        Assert.Empty(game.Obstacles.Active);
        Assert.InRange(game.Player.Y, startY - 10, startY + 10);
    }

    [Fact]
    public void Flap_OnStart_GoesToPlayingAndFlaps()
    {
        var game = TestSupport.CreateGame();

        game.Handle(InputAction.Flap);

        Assert.Equal(GameState.Playing, game.State);
        Assert.Equal(game.Config.Player.FlapVelocity, game.Player.VelocityY);
        Assert.Contains(GameEvent.Started, game.Events);
        Assert.Contains(GameEvent.Flapped, game.Events);
        Assert.Equal(0, game.Score.Score);
    }

    [Fact]
    public void FallingToGround_GoesThroughDyingToGameOver()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);

        Assert.True(TestSupport.RunUntil(game, g => g.State == GameState.Dying, 5));
        Assert.Equal(GameEvent.HitGround, game.DeathCause);

        Assert.True(TestSupport.RunUntil(game, g => g.State == GameState.GameOver, 3));
        Assert.Contains(GameEvent.GameOver, game.Events);
    }

    [Fact]
    public void HittingObstacle_EndsTheRun()
    {
        // Random 0 puts every gap as high as allowed; holding the player low guarantees a hit.
        var game = TestSupport.CreateGame(random: new FixedRandom(0));
        game.Handle(InputAction.Flap);

        TestSupport.RunUntil(game, g => g.State != GameState.Playing, 10, g =>
        {
            g.Player.Y = g.Config.World.GroundY - 60;
            g.Player.VelocityY = 0;
        });

        Assert.Equal(GameEvent.HitObstacle, game.DeathCause);
    }

    [Fact]
    public void Dying_IgnoresInputAndFreezesObstacles()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        TestSupport.RunUntil(game, g => g.State == GameState.Dying, 5);
        var positions = game.Obstacles.Active.Select(p => p.X).ToList();

        game.Handle(InputAction.Flap);
        game.Step(0.1);

        Assert.Equal(GameState.Dying, game.State);
        Assert.Equal(positions, game.Obstacles.Active.Select(p => p.X).ToList());
    }

    [Fact]
    public void GameOver_RestartsToPlayingAfterLock()
    {
        var game = TestSupport.CreateGame(random: new SystemRandomSource(3));
        game.Handle(InputAction.Flap);
        TestSupport.RunUntil(game, g => g.State == GameState.GameOver, 10);

        // Taps right after dying are ignored so the panel is not skipped by accident.
        game.Handle(InputAction.Flap);
        Assert.Equal(GameState.GameOver, game.State);

        TestSupport.RunUntil(game, g => g.CanRestart, 2);
        game.Handle(InputAction.Flap);

        Assert.Equal(GameState.Playing, game.State);
        Assert.Contains(GameEvent.Restarted, game.Events);
        Assert.Equal(0, game.Score.Score);
        Assert.Empty(game.Obstacles.Active);
        Assert.Null(game.DeathCause);
        Assert.Equal(game.Config.Player.X, game.Player.X);
    }

    [Fact]
    public void ManyConsecutiveGames_EachRestartsCleanly()
    {
        var store = new InMemoryHighScoreStore();
        var game = TestSupport.CreateGame(store: store, random: new SystemRandomSource(11));
        game.Handle(InputAction.Flap);

        for (var run = 0; run < 25; run++)
        {
            // Autopilot for a varying amount of time, then let the player drop.
            var flyFor = 2 + run % 7;
            TestSupport.RunUntil(game, g => g.State != GameState.Playing, flyFor, TestSupport.Autopilot);
            Assert.True(TestSupport.RunUntil(game, g => g.State == GameState.GameOver, 15));
            Assert.True(game.Score.Best >= game.Score.Score);
            Assert.Equal(game.Score.Best, store.Value);

            TestSupport.RunUntil(game, g => g.CanRestart, 2);
            game.Handle(InputAction.Flap);
            Assert.Equal(GameState.Playing, game.State);
            Assert.Equal(0, game.Score.Score);
        }

        Assert.InRange(game.Obstacles.AllocatedCount, 1, 6);
    }

    [Fact]
    public void Pause_FreezesTheWorld_AndOnlyExplicitInputResumes()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        game.Update(0.2);
        var y = game.Player.Y;
        var scroll = game.ScrollDistance;

        game.Pause();
        for (var i = 0; i < 100; i++)
        {
            game.Update(0.1);
        }

        Assert.Equal(GameState.Paused, game.State);
        Assert.Equal(y, game.Player.Y);
        Assert.Equal(scroll, game.ScrollDistance);

        game.Handle(InputAction.Flap);
        Assert.Equal(GameState.Playing, game.State);
        Assert.Equal(game.Config.Player.FlapVelocity, game.Player.VelocityY);
    }

    [Fact]
    public void TogglePause_PausesAndResumes()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);

        game.Handle(InputAction.TogglePause);
        Assert.Equal(GameState.Paused, game.State);

        game.Handle(InputAction.TogglePause);
        Assert.Equal(GameState.Playing, game.State);
    }

    [Fact]
    public void Pause_OutsidePlaying_DoesNothing()
    {
        var game = TestSupport.CreateGame();

        game.Pause();
        Assert.Equal(GameState.Start, game.State);

        game.Handle(InputAction.TogglePause);
        Assert.Equal(GameState.Start, game.State);
    }

    [Fact]
    public void StateManager_RejectsInvalidTransitions()
    {
        var states = new GameStateManager();

        Assert.Throws<InvalidOperationException>(() => states.TransitionTo(GameState.GameOver));
        states.TransitionTo(GameState.Playing);
        Assert.Throws<InvalidOperationException>(() => states.TransitionTo(GameState.Start));
        states.TransitionTo(GameState.Dying);
        states.TransitionTo(GameState.GameOver);
        states.TransitionTo(GameState.Playing);
        Assert.Equal(GameState.Playing, states.Current);
    }
}
