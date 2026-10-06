namespace StepRecorder.Core.Settings;

/// <summary>
/// User settings, persisted to <c>settings.json</c>. Sections are immutable records, so a snapshot
/// taken at the start of a session cannot change while it records. Sections from spec §17 are added
/// as the milestone that uses them is built.
/// </summary>
public sealed record RecorderSettings
{
    public RecordingSettings Recording { get; init; } = new();

    public ScreenshotSettings Screenshot { get; init; } = new();

    public StorageSettings Storage { get; init; } = new();

    public ReportSettings Reports { get; init; } = new();
}

/// <summary>What gets recorded. Copied into each session as its settings snapshot.</summary>
public sealed record RecordingSettings
{
    public bool CaptureLeftClick { get; init; } = true;

    public bool CaptureRightClick { get; init; } = true;

    /// <summary>
    /// Spec §17 "duplicate-step suppression": a double- or triple-click on the same spot becomes one step
    /// (with <c>clickCount</c> 2 or 3) instead of several identical ones.
    /// </summary>
    public bool MergeDoubleClicks { get; init; } = true;

    /// <summary>
    /// Ask UI Automation which control was clicked, for descriptions like "Click the Save button". Can be
    /// turned off if an application misbehaves while being inspected.
    /// </summary>
    public bool IdentifyControls { get; init; } = true;
}

public enum ScreenshotFormat
{
    Png,
    Jpeg,
}

/// <summary>How screenshots are stored and marked. Copied into each session as its screenshot snapshot.</summary>
public sealed record ScreenshotSettings
{
    public const int MinJpegQuality = 10;
    public const int MaxJpegQuality = 100;
    public const int MinMarkerSize = 12;
    public const int MaxMarkerSize = 96;

    public ScreenshotFormat Format { get; init; } = ScreenshotFormat.Png;

    /// <summary>1–100; only used for JPEG.</summary>
    public int JpegQuality { get; init; } = 85;

    public bool ClickMarkerEnabled { get; init; } = true;

    /// <summary>Marker diameter at 100% scaling (96 DPI); it grows with the clicked window's DPI.</summary>
    public int ClickMarkerSize { get; init; } = 32;

    /// <summary>A copy with every value inside its allowed range.</summary>
    public ScreenshotSettings Clamped() => this with
    {
        JpegQuality = Math.Clamp(JpegQuality, MinJpegQuality, MaxJpegQuality),
        ClickMarkerSize = Math.Clamp(ClickMarkerSize, MinMarkerSize, MaxMarkerSize),
    };
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
