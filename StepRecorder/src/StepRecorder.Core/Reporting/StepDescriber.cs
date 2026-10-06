using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Reporting;

/// <summary>
/// Plain-text, coordinate-based step descriptions, such as
/// <c>Click at (412, 218) in "MyApplication — Microsoft Visual Studio".</c>
/// UI Automation descriptions (Milestone 5) and user edits are stored in
/// <see cref="Step.GeneratedDescription"/> and take priority.
/// </summary>
public static class StepDescriber
{
    public const string UnknownApplication = "Unknown application";

    public static string Describe(Step step)
    {
        if (!string.IsNullOrWhiteSpace(step.GeneratedDescription))
        {
            return step.GeneratedDescription.Trim();
        }

        string verb = step.MouseButton switch
        {
            MouseButton.Right => "Right-click",
            MouseButton.Middle => "Middle-click",
            _ => "Click",
        };

        if (ShellWindows.IsDesktop(step.WindowClassName))
        {
            return $"{verb} on the desktop.";
        }

        if (ShellWindows.IsTaskbarOrTray(step.WindowClassName))
        {
            return $"{verb} on the taskbar.";
        }

        if (step.ClickXRelativeToWindow is { } x && step.ClickYRelativeToWindow is { } y)
        {
            string where = !string.IsNullOrWhiteSpace(step.WindowTitle)
                ? $"\"{step.WindowTitle.Trim()}\""
                : ApplicationName(step);
            return $"{verb} at ({x}, {y}) in {where}.";
        }

        return step.CursorX is { } screenX && step.CursorY is { } screenY
            ? $"{verb} at screen position ({screenX}, {screenY})."
            : $"{verb}.";
    }

    public static string ApplicationName(Step step) =>
        !string.IsNullOrWhiteSpace(step.ApplicationName) ? step.ApplicationName.Trim()
        : !string.IsNullOrWhiteSpace(step.ProcessName) ? step.ProcessName.Trim()
        : UnknownApplication;
}
