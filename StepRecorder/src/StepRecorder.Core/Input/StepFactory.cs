using StepRecorder.Core.Automation;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Input;

public static class StepFactory
{
    /// <summary>Separator used in <see cref="Step.UIAutomationMenuPath"/>.</summary>
    public const string MenuPathSeparator = " > ";

    /// <summary>
    /// Builds a click step. Without window info (lookup failed or nothing was found), the step keeps
    /// only the button, time and screen position. Without element info it has no control details.
    /// </summary>
    public static Step FromClick(int stepNumber, MouseClick click, WindowInfo? window, UiElementInfo? element = null)
    {
        var step = new Step
        {
            StepNumber = stepNumber,
            Timestamp = click.Timestamp,
            EventType = StepEventType.Click,
            MouseButton = click.Button,
            CursorX = click.X,
            CursorY = click.Y,
        };

        if (window is not null)
        {
            step.ApplicationName = window.ApplicationName;
            step.ProcessName = window.ProcessName;
            step.ProcessId = window.ProcessId;
            step.WindowHandle = window.Handle;
            step.WindowTitle = window.Title;
            step.WindowClassName = window.ClassName;
            step.WindowBounds = window.Bounds;
            step.WindowDpi = window.Dpi;
            step.ClickXRelativeToWindow = click.X - window.Bounds.X;
            step.ClickYRelativeToWindow = click.Y - window.Bounds.Y;
        }

        if (element is not null)
        {
            step.UIAutomationElementName = Clean(element.Name);
            step.UIAutomationControlType = Clean(element.ControlType);
            step.UIAutomationLocalizedControlType = Clean(element.LocalizedControlType);
            step.UIAutomationAutomationId = Clean(element.AutomationId);
            step.UIAutomationBounds = element.Bounds;
            step.IsSensitive = element.IsPassword;

            List<string> menu = element.MenuPath?.Select(Clean).OfType<string>().ToList() ?? [];
            step.UIAutomationMenuPath = menu.Count > 0 ? string.Join(MenuPathSeparator, menu) : null;
        }

        return step;
    }

    private static string? Clean(string? value)
    {
        // Names can contain line breaks or be padded; empty means unknown.
        string? trimmed = value?.ReplaceLineEndings(" ").Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}
