namespace SkyHop.Core;

/// <summary>
/// The actions the game understands. Front ends map their own devices onto these
/// (Space / Up Arrow / mouse click / touch all become <see cref="Flap"/>), so game logic never sees keys or touches.
/// </summary>
public enum InputAction
{
    /// <summary>Flap while playing. Also starts, resumes and restarts, depending on state.</summary>
    Flap,
    TogglePause,
}

/// <summary>Things that happened during an update, for sound, effects and UI.</summary>
public enum GameEvent
{
    Started,
    Restarted,
    Flapped,
    Scored,
    HitObstacle,
    HitGround,
    HitBoundary,
    GameOver,
    NewBest,
    Paused,
    Resumed,
}
