using SkyHop.Core;

namespace SkyHop.Tests;

public class ScoringTests
{
    [Fact]
    public void PassingObstacle_AwardsExactlyOnePoint()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        var playerX = game.Player.X;

        // Keep the player inside the gaps by holding it at the gap center while the world scrolls past.
        var passed = TestSupport.RunUntil(
            game,
            g => g.Obstacles.Active.Count > 0 && g.Obstacles.Active[0].CenterX < playerX - 40,
            maxSeconds: 10,
            eachStep: TestSupport.HoldInGap);

        Assert.True(passed);
        Assert.Equal(GameState.Playing, game.State);
        Assert.Equal(1, game.Score.Score);
        Assert.True(game.Obstacles.Active[0].Scored);
    }

    [Fact]
    public void AwardPassedObstacles_DoesNotScoreTheSamePairTwice()
    {
        var score = new ScoreManager(new InMemoryHighScoreStore());
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        TestSupport.RunUntil(game, g => g.Obstacles.Active.Count > 0, 1, TestSupport.HoldInGap);
        var pair = game.Obstacles.Active[0];
        var pastCenter = pair.CenterX + 1;

        Assert.Equal(1, score.AwardPassedObstacles(game.Obstacles.Active, pastCenter));
        Assert.Equal(0, score.AwardPassedObstacles(game.Obstacles.Active, pastCenter));
        Assert.Equal(0, score.AwardPassedObstacles([pair], pastCenter + 100));
        Assert.Equal(1, score.Score);
    }

    [Fact]
    public void AwardPassedObstacles_DoesNotScoreBeforeCenterIsPassed()
    {
        var score = new ScoreManager(new InMemoryHighScoreStore());
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        TestSupport.RunUntil(game, g => g.Obstacles.Active.Count > 0, 1, TestSupport.HoldInGap);

        Assert.Equal(0, score.AwardPassedObstacles(game.Obstacles.Active, game.Obstacles.Active[0].CenterX - 1));
        Assert.Equal(0, score.Score);
    }

    [Fact]
    public void Autopilot_ScoresOnePointPerPassedPair()
    {
        var game = TestSupport.CreateGame(random: new SystemRandomSource(42));
        game.Handle(InputAction.Flap);
        var seen = new HashSet<int>();

        TestSupport.RunUntil(game, g => g.State != GameState.Playing, maxSeconds: 30, eachStep: g =>
        {
            TestSupport.Autopilot(g);
            foreach (var pair in g.Obstacles.Active.Where(p => p.Scored))
            {
                seen.Add(pair.Id);
            }
        });

        Assert.Equal(GameState.Playing, game.State);
        Assert.True(game.Score.Score > 10, $"Autopilot only scored {game.Score.Score}");
        Assert.Equal(seen.Count, game.Score.Score);
    }

    [Fact]
    public void Autopilot_SurvivesIntoMaxDifficulty()
    {
        // Proves late-game obstacles stay passable: a simple bot must reach the speed cap on every seed.
        for (var seed = 1; seed <= 10; seed++)
        {
            var game = TestSupport.CreateGame(random: new SystemRandomSource(seed));
            game.Handle(InputAction.Flap);

            TestSupport.RunUntil(game, g => g.State != GameState.Playing || g.Score.Score >= 80, 400, TestSupport.Autopilot);

            Assert.True(game.State == GameState.Playing, $"Seed {seed}: died at score {game.Score.Score}");
            Assert.Equal(game.Config.Difficulty.MaxSpeed, game.CurrentDifficulty.Speed);
        }
    }
}
