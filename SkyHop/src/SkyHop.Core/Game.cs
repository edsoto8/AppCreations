namespace SkyHop.Core;

/// <summary>
/// The whole game simulation. Front ends feed it <see cref="InputAction"/>s and frame times,
/// then draw from its public state and react to <see cref="Events"/>.
/// </summary>
public sealed class Game
{
    private readonly List<GameEvent> _events = [];
    private double _accumulator;

    public Game(GameConfig config, IHighScoreStore highScores, IRandomSource random)
    {
        Config = config;
        Score = new ScoreManager(highScores);
        Difficulty = new DifficultyManager(config.Difficulty);
        Obstacles = new ObstacleSpawner(config, random);
        Player.Reset(config.Player);
        CurrentDifficulty = Difficulty.Evaluate(0);
        Speed = CurrentDifficulty.Speed;
    }

    public GameConfig Config { get; }
    public GameStateManager States { get; } = new();
    public GameState State => States.Current;
    public Player Player { get; } = new();
    public ObstacleSpawner Obstacles { get; }
    public ScoreManager Score { get; }
    public DifficultyManager Difficulty { get; }
    public DifficultySnapshot CurrentDifficulty { get; private set; }

    /// <summary>Current horizontal scroll speed. Eases toward the difficulty's target speed.</summary>
    public double Speed { get; private set; }

    /// <summary>Total distance the world has scrolled; drives ground and background parallax.</summary>
    public double ScrollDistance { get; private set; }

    /// <summary>Total simulated time, including the title screen.</summary>
    public double Time { get; private set; }

    /// <summary>What ended the last run, if anything.</summary>
    public GameEvent? DeathCause { get; private set; }

    /// <summary>Events raised since the last <see cref="DrainEvents"/> call.</summary>
    public IReadOnlyList<GameEvent> Events => _events;

    public bool CanRestart =>
        State == GameState.GameOver && States.TimeInState >= Config.Timing.RestartLockDuration;

    public void DrainEvents(List<GameEvent> into)
    {
        into.AddRange(_events);
        _events.Clear();
    }

    public void Handle(InputAction action)
    {
        switch (action)
        {
            case InputAction.Flap:
                HandleFlap();
                break;
            case InputAction.TogglePause when State == GameState.Playing:
                Pause();
                break;
            case InputAction.TogglePause when State == GameState.Paused:
                Resume();
                break;
        }
    }

    private void HandleFlap()
    {
        switch (State)
        {
            case GameState.Start:
                States.TransitionTo(GameState.Playing);
                _events.Add(GameEvent.Started);
                Flap();
                break;
            case GameState.Playing:
                Flap();
                break;
            case GameState.Paused:
                // Resuming with the flap input also flaps, so the player is never left falling helplessly.
                Resume();
                Flap();
                break;
            case GameState.GameOver when CanRestart:
                Restart();
                break;
        }
    }

    private void Flap()
    {
        Player.Flap(Config.Player);
        _events.Add(GameEvent.Flapped);
    }

    /// <summary>Pauses a game in progress. Safe to call in any state, e.g. whenever the app loses focus.</summary>
    public void Pause()
    {
        if (State != GameState.Playing)
        {
            return;
        }

        States.TransitionTo(GameState.Paused);
        _accumulator = 0;
        _events.Add(GameEvent.Paused);
    }

    public void Resume()
    {
        if (State != GameState.Paused)
        {
            return;
        }

        States.TransitionTo(GameState.Playing);
        _accumulator = 0;
        _events.Add(GameEvent.Resumed);
    }

    /// <summary>Starts a fresh run straight from Game Over, without reloading anything.</summary>
    public void Restart()
    {
        if (State != GameState.GameOver)
        {
            return;
        }

        Player.Reset(Config.Player);
        Obstacles.Reset();
        Score.Reset();
        CurrentDifficulty = Difficulty.Evaluate(0);
        Speed = CurrentDifficulty.Speed;
        DeathCause = null;
        _accumulator = 0;

        States.TransitionTo(GameState.Playing);
        _events.Add(GameEvent.Restarted);
        Flap();
    }

    /// <summary>Advances the simulation by one rendered frame, in fixed steps.</summary>
    public void Update(double frameSeconds)
    {
        _accumulator += Math.Clamp(frameSeconds, 0, Config.Timing.MaxFrameDelta);
        var step = Config.Timing.FixedStep;
        while (_accumulator >= step)
        {
            Step(step);
            _accumulator -= step;
        }
    }

    /// <summary>Advances the simulation by exactly <paramref name="dt"/> seconds.</summary>
    public void Step(double dt)
    {
        if (State == GameState.Paused)
        {
            return;
        }

        Time += dt;
        States.Advance(dt);

        switch (State)
        {
            case GameState.Start:
                StepStart(dt);
                break;
            case GameState.Playing:
                StepPlaying(dt);
                break;
            case GameState.Dying:
                StepDying(dt);
                break;
        }
    }

    private void StepStart(double dt)
    {
        var p = Config.Player;
        Player.Y = p.StartY + Math.Sin(Time * Math.PI * 2 * p.IdleBobFrequency) * p.IdleBobAmplitude;
        PlayerPhysics.AnimateWings(Player, dt);
        ScrollDistance += Speed * dt;
    }

    private void StepPlaying(double dt)
    {
        PlayerPhysics.Step(Player, Config, dt);

        Speed = PlayerPhysics.MoveTowards(Speed, CurrentDifficulty.Speed, Config.Difficulty.SpeedEasing * dt);
        ScrollDistance += Speed * dt;
        Obstacles.Update(dt, Speed, CurrentDifficulty);

        if (Score.AwardPassedObstacles(Obstacles.Active, Player.X) > 0)
        {
            _events.Add(GameEvent.Scored);
            CurrentDifficulty = Difficulty.Evaluate(Score.Score);
        }

        var cause = DetectCollision();
        if (cause is not null)
        {
            Die(cause.Value);
        }
    }

    public GameEvent? DetectCollision()
    {
        var radius = Config.Player.HitboxRadius;
        if (Player.OnGround || Player.Y + radius >= Config.World.GroundY)
        {
            return GameEvent.HitGround;
        }

        if (Config.World.CeilingIsLethal && Player.Y + radius < 0)
        {
            return GameEvent.HitBoundary;
        }

        var inset = Config.Obstacles.HitboxInset;
        foreach (var pair in Obstacles.Active)
        {
            if (Collision.CircleIntersectsRect(Player.X, Player.Y, radius, pair.TopHitbox(inset)) ||
                Collision.CircleIntersectsRect(Player.X, Player.Y, radius, pair.BottomHitbox(inset, Config.World.GroundY)))
            {
                return GameEvent.HitObstacle;
            }
        }

        return null;
    }

    private void Die(GameEvent cause)
    {
        DeathCause = cause;
        States.TransitionTo(GameState.Dying);
        _events.Add(cause);

        // A small hop on obstacle hits makes the impact read clearly before the fall.
        if (cause == GameEvent.HitObstacle)
        {
            Player.VelocityY = Math.Min(Player.VelocityY, -120);
        }
    }

    private void StepDying(double dt)
    {
        var p = Config.Player;
        Player.VelocityY = Math.Min(Player.VelocityY + p.Gravity * 1.2 * dt, p.MaxFallVelocity * 1.4);
        Player.Y += Player.VelocityY * dt;

        var floor = Config.World.GroundY - p.HitboxRadius;
        if (Player.Y >= floor)
        {
            Player.Y = floor;
            Player.VelocityY = 0;
            Player.OnGround = true;
        }

        Player.Rotation = PlayerPhysics.MoveTowards(Player.Rotation, p.MaxFallRotation, 540 * dt);

        var timing = Config.Timing;
        var settled = Player.OnGround && States.TimeInState >= timing.DeathMinDuration;
        if (settled || States.TimeInState >= timing.DeathMaxDuration)
        {
            States.TransitionTo(GameState.GameOver);
            _events.Add(GameEvent.GameOver);
            if (Score.CommitBest())
            {
                _events.Add(GameEvent.NewBest);
            }
        }
    }
}
