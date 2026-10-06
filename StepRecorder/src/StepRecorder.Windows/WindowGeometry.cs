using System.Runtime.InteropServices;
using StepRecorder.Core.Sessions;
using static StepRecorder.Windows.NativeMethods;

namespace StepRecorder.Windows;

internal static class WindowGeometry
{
    /// <summary>
    /// The visible window frame in physical pixels. DWM's extended frame bounds leave out the invisible
    /// resize border and shadow that <c>GetWindowRect</c> includes.
    /// </summary>
    public static ScreenRect GetFrameBounds(IntPtr hwnd)
    {
        if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT frame, Marshal.SizeOf<RECT>()) != 0)
        {
            GetWindowRect(hwnd, out frame);
        }

        return new ScreenRect(frame.Left, frame.Top, frame.Right - frame.Left, frame.Bottom - frame.Top);
    }
}
