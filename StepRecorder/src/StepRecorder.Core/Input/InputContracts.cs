using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Input;

/// <summary>A mouse button press, in physical virtual-desktop pixels.</summary>
public readonly record struct MouseClick(MouseButton Button, int X, int Y, DateTimeOffset Timestamp);

/// <summary>
/// Delivers global mouse clicks. Implementations call <c>onClick</c> on their own thread and must
/// return quickly from it, so the callback only queues the click.
/// </summary>
public interface IMouseClickSource : IDisposable
{
    /// <summary>Starts observing clicks. Calling it while started does nothing.</summary>
    /// <exception cref="InvalidOperationException">The source could not be started.</exception>
    void Start(Action<MouseClick> onClick);

    /// <summary>Stops observing clicks. Calling it while stopped does nothing.</summary>
    void Stop();
}

/// <summary>The top-level window that contains a screen point.</summary>
public sealed record WindowInfo(
    long Handle,
    int ProcessId,
    string ProcessName,
    string ApplicationName,
    string Title,
    string ClassName,
    ScreenRect Bounds,
    int? Dpi);

/// <summary>Finds the window under a point. Implementations may throw; callers treat that as "unknown".</summary>
public interface IWindowInspector
{
    WindowInfo? GetTopLevelWindowAt(int x, int y);
}
