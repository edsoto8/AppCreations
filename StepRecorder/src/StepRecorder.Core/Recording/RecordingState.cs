namespace StepRecorder.Core.Recording;

public enum RecordingState
{
    Idle,
    Recording,
    Paused,
}

public sealed class RecordingStateChangedEventArgs(RecordingState previous, RecordingState current) : EventArgs
{
    public RecordingState Previous { get; } = previous;

    public RecordingState Current { get; } = current;
}

/// <summary>Facts about the machine and app that are stamped onto every new session.</summary>
public sealed record SessionEnvironment(string ApplicationVersion, string OperatingSystem);
