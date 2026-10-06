using System.Collections.Concurrent;
using System.Diagnostics;
using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;
using static StepRecorder.Windows.NativeMethods;

namespace StepRecorder.Windows;

/// <summary>
/// Finds the top-level window under a screen point with Win32 calls that never send messages to the
/// target window, so a hung application cannot stall the recorder (docs/decisions/0002).
/// </summary>
public sealed class Win32WindowInspector : IWindowInspector
{
    // File descriptions rarely change while the recorder runs; cache them by executable path.
    private readonly ConcurrentDictionary<string, string> applicationNames = new(StringComparer.OrdinalIgnoreCase);

    public WindowInfo? GetTopLevelWindowAt(int x, int y)
    {
        IntPtr child = WindowFromPoint(new POINT { X = x, Y = y });
        if (child == IntPtr.Zero)
        {
            return null;
        }

        IntPtr root = GetAncestor(child, GA_ROOT);
        if (root == IntPtr.Zero)
        {
            root = child;
        }

        GetWindowThreadProcessId(root, out uint processId);
        if (processId == (uint)Environment.ProcessId)
        {
            // The recorder's own windows are never recorded. Reading their text would also send
            // WM_GETTEXT to our UI thread, so stop here.
            return new WindowInfo(root.ToInt64(), (int)processId, "", "", "", "", default, null);
        }

        string? imagePath = GetProcessImagePath(processId);
        string processName = imagePath is null ? "" : Path.GetFileNameWithoutExtension(imagePath);

        // Popups such as menus and drop-downs have no title; use their owner's so steps still say where they happened.
        string title = GetText(root);
        if (title.Length == 0)
        {
            IntPtr owner = GetAncestor(child, GA_ROOTOWNER);
            if (owner != IntPtr.Zero && owner != root)
            {
                title = GetText(owner);
            }
        }

        uint dpi = GetDpiForWindow(root);

        return new WindowInfo(
            Handle: root.ToInt64(),
            ProcessId: (int)processId,
            ProcessName: processName,
            ApplicationName: imagePath is null ? processName : GetApplicationName(imagePath, processName),
            Title: title,
            ClassName: GetClass(root),
            Bounds: WindowGeometry.GetFrameBounds(root),
            Dpi: dpi == 0 ? null : (int)dpi);
    }

    // For windows of other processes GetWindowText reads the stored caption without sending WM_GETTEXT.
    private static string GetText(IntPtr hwnd)
    {
        int length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return "";
        }

        char[] buffer = new char[length + 1];
        int copied = GetWindowText(hwnd, buffer, buffer.Length);
        return new string(buffer, 0, Math.Max(0, copied));
    }

    private static string GetClass(IntPtr hwnd)
    {
        char[] buffer = new char[256];
        int copied = GetClassName(hwnd, buffer, buffer.Length);
        return new string(buffer, 0, Math.Max(0, copied));
    }

    // PROCESS_QUERY_LIMITED_INFORMATION works for most processes, including elevated ones.
    private static string? GetProcessImagePath(uint processId)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (process == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            char[] buffer = new char[1024];
            int size = buffer.Length;
            return QueryFullProcessImageName(process, 0, buffer, ref size) ? new string(buffer, 0, size) : null;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private string GetApplicationName(string imagePath, string fallback) =>
        applicationNames.GetOrAdd(imagePath, path =>
        {
            try
            {
                string? description = FileVersionInfo.GetVersionInfo(path).FileDescription?.Trim();
                return string.IsNullOrEmpty(description) ? fallback : description;
            }
            catch (Exception ex) when (ex is FileNotFoundException or UnauthorizedAccessException or IOException)
            {
                return fallback;
            }
        });
}
