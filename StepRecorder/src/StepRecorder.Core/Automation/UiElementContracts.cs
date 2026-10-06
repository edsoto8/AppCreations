using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Automation;

/// <summary>
/// The UI Automation element under a click. Only identifying properties are read. Element values
/// (text box contents, passwords) are never read (spec §12, §18).
/// </summary>
/// <param name="ControlType">Programmatic control type without its prefix, such as <c>Button</c> or <c>MenuItem</c>.</param>
/// <param name="LocalizedControlType">The control type in the user's language, such as <c>split button</c>.</param>
/// <param name="MenuPath">For menu items, the names from the top menu down, such as <c>["File", "Export"]</c>.</param>
public sealed record UiElementInfo(
    string? Name,
    string? ControlType,
    string? LocalizedControlType,
    string? AutomationId,
    ScreenRect? Bounds,
    bool IsPassword,
    IReadOnlyList<string>? MenuPath = null);

/// <summary>
/// Looks up the UI Automation element at a screen point. Calls go to other processes and can be slow,
/// so callers run them off the click consumer with a timeout. Implementations may throw; callers treat
/// that as "unknown".
/// </summary>
public interface IUiElementInspector
{
    UiElementInfo? GetElementAt(int x, int y);
}
