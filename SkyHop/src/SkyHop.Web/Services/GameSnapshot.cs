using SkyHop.Core;

namespace SkyHop.Web.Services;

/// <summary>
/// Everything the JavaScript renderer needs for one frame. A single instance is refilled every frame
/// (obstacle views are pooled too), so the steady-state game loop does not allocate per obstacle.
/// </summary>
public sealed class GameSnapshot
{
    private readonly List<ObstacleView> _obstaclePool = [];

    public string State { get; private set; } = "";
    public double Time { get; private set; }
    public double PlayerX { get; private set; }
    public double PlayerY { get; private set; }
    public double PlayerVelocityY { get; private set; }
    public double PlayerRotation { get; private set; }
    public double WingPhase { get; private set; }
    public List<ObstacleView> Obstacles { get; } = [];
    public int Score { get; private set; }
    public int Best { get; private set; }
    public bool IsNewBest { get; private set; }
    public double Scroll { get; private set; }
    public double Speed { get; private set; }
    public int Level { get; private set; }
    public string LevelName { get; private set; } = "";
    public List<string> Events { get; } = [];
    public bool Muted { get; private set; }
    public bool Debug { get; private set; }

    public void Fill(Game game, IReadOnlyList<GameEvent> events, bool muted, bool debug)
    {
        State = game.State.ToString();
        Time = game.Time;
        PlayerX = game.Player.X;
        PlayerY = game.Player.Y;
        PlayerVelocityY = game.Player.VelocityY;
        PlayerRotation = game.Player.Rotation;
        WingPhase = game.Player.WingPhase;
        Score = game.Score.Score;
        Best = game.Score.Best;
        IsNewBest = game.Score.IsNewBest;
        Scroll = game.ScrollDistance;
        Speed = game.Speed;
        Level = game.CurrentDifficulty.Level;
        LevelName = game.CurrentDifficulty.LevelName;
        Muted = muted;
        Debug = debug;

        Events.Clear();
        foreach (var e in events)
        {
            Events.Add(e.ToString());
        }

        Obstacles.Clear();
        var active = game.Obstacles.Active;
        while (_obstaclePool.Count < active.Count)
        {
            _obstaclePool.Add(new ObstacleView());
        }

        for (var i = 0; i < active.Count; i++)
        {
            var view = _obstaclePool[i];
            view.Set(active[i]);
            Obstacles.Add(view);
        }
    }
}

public sealed class ObstacleView
{
    public int Id { get; private set; }
    public double X { get; private set; }
    public double Width { get; private set; }
    public double GapTop { get; private set; }
    public double GapBottom { get; private set; }
    public bool Scored { get; private set; }

    public void Set(ObstaclePair pair)
    {
        Id = pair.Id;
        X = pair.X;
        Width = pair.Width;
        GapTop = pair.GapTop;
        GapBottom = pair.GapBottom;
        Scored = pair.Scored;
    }
}
