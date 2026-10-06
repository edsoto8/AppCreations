using System.Text.Json.Serialization;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Sessions;

/// <summary>
/// One recording. Serialized to <c>session.json</c> inside the session directory.
/// </summary>
public sealed class Session
{
    public Guid SessionId { get; init; } = Guid.NewGuid();

    public string Name { get; set; } = "";

    public SessionStatus Status { get; set; } = SessionStatus.Recording;

    public DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; set; }

    /// <summary>Wall-clock time from start to stop, including pauses.</summary>
    public TimeSpan? Duration { get; set; }

    /// <summary>Time spent actually recording, i.e. <see cref="Duration"/> minus pauses.</summary>
    public TimeSpan? ActiveDuration { get; set; }

    public string ApplicationVersion { get; init; } = "";

    public string OperatingSystem { get; init; } = "";

    public int StepCount => Steps.Count;

    public RecordingSettings RecordingSettingsSnapshot { get; init; } = new();

    public List<Step> Steps { get; init; } = [];

    /// <summary>
    /// Absolute path of the session folder. Runtime only: it is never written to <c>session.json</c>,
    /// so the folder can be moved or zipped.
    /// </summary>
    [JsonIgnore]
    public string Directory { get; set; } = "";
}
