using SkyHop.Core;

namespace SkyHop.Tests;

public class DifficultyTests
{
    private static readonly DifficultyConfig Config = GameConfig.Default.Difficulty;
    private readonly DifficultyManager _difficulty = new(Config);

    [Theory]
    [InlineData(0, 1, "Beginner")]
    [InlineData(10, 1, "Beginner")]
    [InlineData(11, 2, "Moderate")]
    [InlineData(25, 2, "Moderate")]
    [InlineData(26, 3, "Advanced")]
    [InlineData(500, 3, "Advanced")]
    public void Level_ChangesAtConfiguredThresholds(int score, int level, string name)
    {
        var snapshot = _difficulty.Evaluate(score);

        Assert.Equal(level, snapshot.Level);
        Assert.Equal(name, snapshot.LevelName);
    }

    [Fact]
    public void Beginner_UsesBaseValuesThroughout()
    {
        for (var score = 0; score <= Config.BeginnerMaxScore; score++)
        {
            var snapshot = _difficulty.Evaluate(score);
            Assert.Equal(Config.BaseSpeed, snapshot.Speed);
            Assert.Equal(Config.BaseGapSize, snapshot.GapSize);
            Assert.Equal(Config.BaseSpacing, snapshot.Spacing);
        }
    }

    [Fact]
    public void Moderate_IncreasesSpeedPerPoint()
    {
        var atStart = _difficulty.Evaluate(Config.BeginnerMaxScore);
        var oneIn = _difficulty.Evaluate(Config.BeginnerMaxScore + 1);
        var atEnd = _difficulty.Evaluate(Config.ModerateMaxScore);

        Assert.Equal(Config.BaseSpeed + Config.ModerateSpeedIncreasePerPoint, oneIn.Speed, 6);
        var tierPoints = Config.ModerateMaxScore - Config.BeginnerMaxScore;
        Assert.Equal(atStart.Speed + tierPoints * Config.ModerateSpeedIncreasePerPoint, atEnd.Speed, 6);
    }

    [Fact]
    public void Advanced_KeepsIncreasingMoreSlowly()
    {
        var moderateEnd = _difficulty.Evaluate(Config.ModerateMaxScore);
        var advanced = _difficulty.Evaluate(Config.ModerateMaxScore + 1);

        Assert.Equal(moderateEnd.Speed + Config.AdvancedSpeedIncreasePerPoint, advanced.Speed, 6);
        Assert.True(Config.AdvancedSpeedIncreasePerPoint < Config.ModerateSpeedIncreasePerPoint);
    }

    [Fact]
    public void Progression_IsGradualAndBounded()
    {
        var previous = _difficulty.Evaluate(0);
        for (var score = 1; score <= 1000; score++)
        {
            var current = _difficulty.Evaluate(score);

            Assert.InRange(current.Speed - previous.Speed, 0, Config.ModerateSpeedIncreasePerPoint + 1e-9);
            Assert.True(current.GapSize <= previous.GapSize);
            Assert.True(current.Spacing <= previous.Spacing);
            Assert.True(current.Speed <= Config.MaxSpeed);
            Assert.True(current.GapSize >= Config.MinGapSize);
            Assert.True(current.Spacing >= Config.MinSpacing);
            Assert.True(current.MaxGapShift <= Config.MaxGapShiftLimit);
            previous = current;
        }

        Assert.Equal(Config.MaxSpeed, previous.Speed);
        Assert.Equal(Config.MinGapSize, previous.GapSize);
    }

    [Fact]
    public void Game_EasesSpeedTowardTargetInsteadOfJumping()
    {
        var game = TestSupport.CreateGame();
        game.Handle(InputAction.Flap);
        // Bank 40 points directly, then let one real pass trigger the difficulty update.
        game.Score.AwardPassedObstacles(Enumerable.Range(0, 40).Select(_ => new ObstaclePair()).ToList(), double.MaxValue);
        var before = game.Speed;
        TestSupport.RunUntil(game, g => g.Obstacles.Active.Count > 0 && g.Obstacles.Active[0].Scored, 10, TestSupport.HoldInGap);

        Assert.True(game.CurrentDifficulty.Speed > before);
        Assert.True(game.Speed < game.CurrentDifficulty.Speed, "Speed should ease up, not snap to the target");
        var maxStepChange = Config.SpeedEasing * game.Config.Timing.FixedStep;
        var last = game.Speed;
        game.Step(game.Config.Timing.FixedStep);
        Assert.InRange(game.Speed - last, 0, maxStepChange + 1e-9);
    }
}
