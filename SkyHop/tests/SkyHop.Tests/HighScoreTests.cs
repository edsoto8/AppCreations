using SkyHop.Core;

namespace SkyHop.Tests;

public class HighScoreTests
{
    [Fact]
    public void NewHighScore_ReplacesOldHighScore()
    {
        var store = new InMemoryHighScoreStore(initial: 3);
        var score = new ScoreManager(store);
        AddPoints(score, 5);

        Assert.True(score.CommitBest());
        Assert.True(score.IsNewBest);
        Assert.Equal(5, score.Best);
        Assert.Equal(5, store.Value);
    }

    [Fact]
    public void LowerScore_DoesNotReplaceHighScore()
    {
        var store = new InMemoryHighScoreStore(initial: 9);
        var score = new ScoreManager(store);
        AddPoints(score, 4);

        Assert.False(score.CommitBest());
        Assert.False(score.IsNewBest);
        Assert.Equal(9, score.Best);
        Assert.Equal(9, store.Value);
        Assert.Equal(0, store.SaveCount);
    }

    [Fact]
    public void EqualScore_IsNotANewBest()
    {
        var store = new InMemoryHighScoreStore(initial: 4);
        var score = new ScoreManager(store);
        AddPoints(score, 4);

        Assert.False(score.CommitBest());
        Assert.Equal(0, store.SaveCount);
    }

    [Fact]
    public void Best_IsLoadedFromStoreOnStartup()
    {
        var score = new ScoreManager(new InMemoryHighScoreStore(initial: 17));

        Assert.Equal(17, score.Best);
        Assert.Equal(0, score.Score);
    }

    [Fact]
    public void Best_SurvivesRestartAndNewManagerInstance()
    {
        var store = new InMemoryHighScoreStore();
        var game = TestSupport.CreateGame(store: store);
        game.Handle(InputAction.Flap);
        TestSupport.RunUntil(game, g => g.Obstacles.Active.Count > 0, 1);
        game.Score.AwardPassedObstacles(game.Obstacles.Active, double.MaxValue);
        TestSupport.RunUntil(game, g => g.State == GameState.GameOver, 10);

        Assert.Equal(1, store.Value);

        TestSupport.RunUntil(game, g => g.CanRestart, 2);
        game.Handle(InputAction.Flap);
        Assert.Equal(0, game.Score.Score);
        Assert.Equal(1, game.Score.Best);

        // A brand-new game (like reopening the app) reads the persisted best.
        Assert.Equal(1, TestSupport.CreateGame(store: store).Score.Best);
    }

    private static void AddPoints(ScoreManager score, int points)
    {
        var pairs = Enumerable.Range(0, points).Select(_ => new ObstaclePair()).ToList();
        score.AwardPassedObstacles(pairs, double.MaxValue);
    }
}
