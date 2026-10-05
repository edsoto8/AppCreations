namespace SkyHop.Core;

public enum GameState
{
    /// <summary>Title screen; the player bobs and nothing can hurt it.</summary>
    Start,
    Playing,

    /// <summary>Playing, frozen. Entered on Pause input or when the app loses focus.</summary>
    Paused,

    /// <summary>Short death animation after a collision; input is ignored.</summary>
    Dying,
    GameOver,
}

/// <summary>Owns the current state and rejects transitions the game does not allow.</summary>
public sealed class GameStateManager
{
    private static readonly Dictionary<GameState, GameState[]> AllowedTransitions = new()
    {
        [GameState.Start] = [GameState.Playing],
        [GameState.Playing] = [GameState.Paused, GameState.Dying],
        [GameState.Paused] = [GameState.Playing],
        [GameState.Dying] = [GameState.GameOver],
        [GameState.GameOver] = [GameState.Playing],
    };

    public GameState Current { get; private set; } = GameState.Start;

    /// <summary>Seconds of simulated time spent in the current state.</summary>
    public double TimeInState { get; private set; }

    public bool CanTransitionTo(GameState next) => AllowedTransitions[Current].Contains(next);

    public void TransitionTo(GameState next)
    {
        if (!CanTransitionTo(next))
        {
            throw new InvalidOperationException($"Cannot go from {Current} to {next}.");
        }

        Current = next;
        TimeInState = 0;
    }

    public void Advance(double dt) => TimeInState += dt;
}
