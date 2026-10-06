namespace StepRecorder.Core.Sessions;

/// <summary>
/// One recorded interaction. Fields are filled in by later milestones (input, capture, UI Automation);
/// anything not yet known stays null.
/// </summary>
public sealed class Step
{
    public int StepNumber { get; init; }

    public DateTimeOffset Timestamp { get; init; }

    public StepEventType EventType { get; init; }

    public MouseButton? MouseButton { get; init; }

    /// <summary>2 for a double-click, 3 for a triple-click; null means a single click.</summary>
    public int? ClickCount { get; set; }

    /// <summary>Cursor position in physical virtual-desktop pixels.</summary>
    public int? CursorX { get; init; }

    public int? CursorY { get; init; }

    /// <summary>Friendly application name (the executable's file description when it has one).</summary>
    public string? ApplicationName { get; set; }

    /// <summary>Executable name without extension, such as <c>notepad</c>.</summary>
    public string? ProcessName { get; set; }

    public int? ProcessId { get; set; }

    /// <summary>Window handle at recording time. Only meaningful while that window exists.</summary>
    public long? WindowHandle { get; set; }

    public string? WindowTitle { get; set; }

    public string? WindowClassName { get; set; }

    /// <summary>Visible window frame (no drop shadow) in physical virtual-desktop pixels.</summary>
    public ScreenRect? WindowBounds { get; set; }

    public int? WindowDpi { get; set; }

    public ScreenshotStatus? ScreenshotStatus { get; set; }

    /// <summary>Path relative to the session directory, using forward slashes.</summary>
    public string? ScreenshotPath { get; set; }

    public int? ScreenshotWidth { get; set; }

    public int? ScreenshotHeight { get; set; }

    /// <summary>How the image was taken, such as <c>PrintWindow</c> or <c>ScreenCopy</c>.</summary>
    public string? ScreenshotMethod { get; set; }

    /// <summary>Why there is no screenshot, or a caveat about the one there is.</summary>
    public string? ScreenshotNote { get; set; }

    public int? ClickXRelativeToWindow { get; set; }

    public int? ClickYRelativeToWindow { get; set; }

    public string? UIAutomationElementName { get; set; }

    public string? UIAutomationControlType { get; set; }

    public string? UIAutomationAutomationId { get; set; }

    public string? GeneratedDescription { get; set; }

    public bool IsSensitive { get; set; }

    public bool IsRedacted { get; set; }
}

public enum StepEventType
{
    Click,
}

public enum ScreenshotStatus
{
    Captured,

    /// <summary>A capture was attempted and failed (window closed, protected, access denied...).</summary>
    Unavailable,

    /// <summary>Deliberately not captured, for example a click on the desktop itself.</summary>
    Skipped,
}

public enum MouseButton
{
    Left,
    Right,
    Middle,
}

/// <summary>A rectangle in physical virtual-desktop pixels.</summary>
public readonly record struct ScreenRect(int X, int Y, int Width, int Height)
{
    public int Right => X + Width;

    public int Bottom => Y + Height;

    public bool IsEmpty => Width <= 0 || Height <= 0;

    /// <summary>The overlap of two rectangles, or an empty rectangle when they do not overlap.</summary>
    public ScreenRect Intersect(ScreenRect other)
    {
        int left = Math.Max(X, other.X);
        int top = Math.Max(Y, other.Y);
        int right = Math.Min(Right, other.Right);
        int bottom = Math.Min(Bottom, other.Bottom);
        return right <= left || bottom <= top ? default : new ScreenRect(left, top, right - left, bottom - top);
    }

    /// <summary>This rectangle in the coordinate space whose origin is <paramref name="origin"/>'s top-left.</summary>
    public ScreenRect RelativeTo(ScreenRect origin) => this with { X = X - origin.X, Y = Y - origin.Y };
}
