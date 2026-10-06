namespace StepRecorder.Core.Sessions;

/// <summary>
/// Persisted lifecycle of a session. A session left in <see cref="Recording"/> or <see cref="Paused"/>
/// on disk was interrupted (for example by a crash) and can be recovered.
/// </summary>
public enum SessionStatus
{
    Recording,
    Paused,
    Completed,
}
