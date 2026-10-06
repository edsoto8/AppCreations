namespace StepRecorder.Core.Input;

/// <summary>Window classes of the Windows shell: taskbar, notification area and desktop.</summary>
public static class ShellWindows
{
    private static readonly HashSet<string> TrayClasses = new(StringComparer.Ordinal)
    {
        "Shell_TrayWnd",                         // primary taskbar (Windows 10 and 11)
        "Shell_SecondaryTrayWnd",                // taskbars on other monitors
        "NotifyIconOverflowWindow",              // Windows 10 hidden-icons flyout
        "TopLevelWindowForOverflowXamlIsland",   // Windows 11 hidden-icons flyout
    };

    private static readonly HashSet<string> DesktopClasses = new(StringComparer.Ordinal)
    {
        "Progman",   // desktop icons window
        "WorkerW",   // desktop background layer
    };

    /// <summary>The desktop spans every monitor, so it is never captured (spec §9).</summary>
    public static bool IsDesktop(string? className) => className is not null && DesktopClasses.Contains(className);

    public static bool IsTaskbarOrTray(string? className) => className is not null && TrayClasses.Contains(className);
}
