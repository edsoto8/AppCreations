using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Input;

public static class StepFactory
{
    /// <summary>
    /// Builds a click step. Without window info (lookup failed or nothing was found), the step keeps
    /// only the button, time and screen position.
    /// </summary>
    public static Step FromClick(int stepNumber, MouseClick click, WindowInfo? window)
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

        return step;
    }
}
