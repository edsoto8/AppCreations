namespace SkyHop.Core;

/// <summary>Persists the best score. The web app uses browser localStorage; tests use memory.</summary>
public interface IHighScoreStore
{
    int Load();
    void Save(int score);
}

public sealed class InMemoryHighScoreStore(int initial = 0) : IHighScoreStore
{
    public int Value { get; private set; } = initial;
    public int SaveCount { get; private set; }

    public int Load() => Value;

    public void Save(int score)
    {
        Value = score;
        SaveCount++;
    }
}

public sealed class ScoreManager
{
    private readonly IHighScoreStore _store;

    public ScoreManager(IHighScoreStore store)
    {
        _store = store;
        Best = Math.Max(0, store.Load());
    }

    public int Score { get; private set; }
    public int Best { get; private set; }

    /// <summary>True when the last committed run beat the previous best.</summary>
    public bool IsNewBest { get; private set; }

    public void Reset()
    {
        Score = 0;
        IsNewBest = false;
    }

    /// <summary>
    /// Awards one point for every pair whose center the player has passed and that has not scored yet.
    /// Returns the number of points awarded.
    /// </summary>
    public int AwardPassedObstacles(IReadOnlyList<ObstaclePair> obstacles, double playerX)
    {
        var awarded = 0;
        foreach (var pair in obstacles)
        {
            if (!pair.Scored && pair.CenterX < playerX)
            {
                pair.Scored = true;
                Score++;
                awarded++;
            }
        }

        return awarded;
    }

    /// <summary>Saves the score if it beats the best. Returns true for a new best.</summary>
    public bool CommitBest()
    {
        IsNewBest = Score > Best;
        if (IsNewBest)
        {
            Best = Score;
            _store.Save(Best);
        }

        return IsNewBest;
    }
}
