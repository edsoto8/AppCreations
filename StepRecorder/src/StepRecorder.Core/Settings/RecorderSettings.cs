namespace StepRecorder.Core.Settings;

/// <summary>
/// User settings, persisted to <c>settings.json</c>. Sections are immutable records, so a snapshot
/// taken at the start of a session cannot change while it records. Sections from spec §17 are added
/// as the milestone that uses them is built.
/// </summary>
public sealed record RecorderSettings
{
    public RecordingSettings Recording { get; init; } = new();

    public StorageSettings Storage { get; init; } = new();

    public ReportSettings Reports { get; init; } = new();
}

/// <summary>What gets recorded. Copied into each session as its settings snapshot.</summary>
public sealed record RecordingSettings
{
    public bool CaptureLeftClick { get; init; } = true;

    public bool CaptureRightClick { get; init; } = true;
}

/// <summary>Which reports are written when a recording stops. At least one should be on.</summary>
public sealed record ReportSettings
{
    public bool GenerateHtml { get; init; } = true;

    public bool GenerateMarkdown { get; init; } = true;
}

public sealed record StorageSettings
{
    public const string DefaultName = "Recording";

    /// <summary>Folder that holds one sub-folder per session. Empty means the platform default.</summary>
    public string RecordingsDirectory { get; init; } = "";

    /// <summary>Name used for new sessions; it becomes part of the session folder name.</summary>
    public string DefaultSessionName { get; init; } = DefaultName;
}
