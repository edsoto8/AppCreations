using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using StepRecorder.Core.Capture;
using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;
using static StepRecorder.Windows.NativeMethods;

namespace StepRecorder.Windows;

/// <summary>
/// Captures a single window (docs/decisions/0003):
/// <list type="number">
/// <item><c>PrintWindow(PW_RENDERFULLCONTENT)</c>: the window's own content, even where other windows
/// cover it or it hangs off-screen.</item>
/// <item>Fallback: copy the window's area from the screen. This works for windows that refuse
/// <c>PrintWindow</c>, but shows whatever is on top of them.</item>
/// </list>
/// Both are cropped to the visible frame (no invisible resize border or shadow). Coordinates are
/// physical pixels because the process is Per-Monitor V2 DPI aware.
/// </summary>
public sealed class Win32WindowCapture : IWindowCapture
{
    public const string PrintWindowMethod = "PrintWindow";
    public const string ScreenCopyMethod = "ScreenCopy";

    // Grid of pixels sampled to decide whether an image is blank (all black).
    private const int BlankSampleGrid = 48;

    public CaptureResult Capture(WindowInfo window)
    {
        var hwnd = new IntPtr(window.Handle);
        if (!IsWindow(hwnd))
        {
            return CaptureResult.Failed("The window closed before it could be captured.");
        }

        if (IsIconic(hwnd))
        {
            return CaptureResult.Failed("The window is minimized.");
        }

        // Re-read the frame: the window may have moved or resized since the click was looked up.
        ScreenRect frame = WindowGeometry.GetFrameBounds(hwnd);
        if (frame.IsEmpty)
        {
            return CaptureResult.Failed("The window has no visible area.");
        }

        string? printWindowProblem;

        // PrintWindow asks the window to paint, which blocks if its app is hung; copy from the screen instead.
        if (IsHungAppWindow(hwnd))
        {
            printWindowProblem = "the window is not responding";
        }
        else
        {
            using Bitmap? printed = TryPrintWindow(hwnd, frame);
            if (printed is not null && !IsBlank(printed))
            {
                return Encode(printed, PrintWindowMethod, note: null);
            }

            printWindowProblem = printed is null ? "PrintWindow failed" : "PrintWindow returned a blank image";
        }

        using Bitmap? copied = TryCopyFromScreen(frame);
        if (copied is null)
        {
            return CaptureResult.Failed($"The window could not be captured ({printWindowProblem}, and the screen could not be read).");
        }

        string note = IsBlank(copied)
            ? $"The image may be blank: {printWindowProblem}, and the screen copy is black (protected content or a GPU surface)."
            : $"Copied from the screen because {printWindowProblem}; overlapping windows may show.";
        return Encode(copied, ScreenCopyMethod, note);
    }

    private static Bitmap? TryPrintWindow(IntPtr hwnd, ScreenRect frame)
    {
        // PrintWindow paints the whole window rectangle, which includes the invisible borders around the frame.
        if (!GetWindowRect(hwnd, out RECT rect))
        {
            return null;
        }

        var windowRect = new ScreenRect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
        ScreenRect crop = frame.Intersect(windowRect).RelativeTo(windowRect);
        if (windowRect.IsEmpty || crop.IsEmpty)
        {
            return null;
        }

        // 32bpp RGB, not ARGB: PrintWindow leaves the alpha of GDI content at 0, which would save as transparent.
        using var full = new Bitmap(windowRect.Width, windowRect.Height, PixelFormat.Format32bppRgb);
        using (Graphics graphics = Graphics.FromImage(full))
        {
            IntPtr hdc = graphics.GetHdc();
            try
            {
                if (!PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT))
                {
                    return null;
                }
            }
            finally
            {
                graphics.ReleaseHdc(hdc);
            }
        }

        return full.Clone(new Rectangle(crop.X, crop.Y, crop.Width, crop.Height), PixelFormat.Format24bppRgb);
    }

    private static Bitmap? TryCopyFromScreen(ScreenRect frame)
    {
        var bitmap = new Bitmap(frame.Width, frame.Height, PixelFormat.Format24bppRgb);
        try
        {
            using Graphics graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen(frame.X, frame.Y, 0, 0, new Size(frame.Width, frame.Height), CopyPixelOperation.SourceCopy);
            return bitmap;
        }
        catch (Win32Exception)
        {
            // For example while the secure desktop (UAC, lock screen) is showing.
            bitmap.Dispose();
            return null;
        }
    }

    /// <summary>True when every sampled pixel is (near) black, which is what failed captures look like.</summary>
    private static bool IsBlank(Bitmap bitmap)
    {
        BitmapData data = bitmap.LockBits(
            new Rectangle(0, 0, bitmap.Width, bitmap.Height),
            ImageLockMode.ReadOnly,
            PixelFormat.Format24bppRgb);
        try
        {
            int stepX = Math.Max(1, bitmap.Width / BlankSampleGrid);
            int stepY = Math.Max(1, bitmap.Height / BlankSampleGrid);
            for (int y = 0; y < bitmap.Height; y += stepY)
            {
                IntPtr row = data.Scan0 + (y * data.Stride);
                for (int x = 0; x < bitmap.Width; x += stepX)
                {
                    int offset = x * 3;
                    byte b = Marshal.ReadByte(row, offset);
                    byte g = Marshal.ReadByte(row, offset + 1);
                    byte r = Marshal.ReadByte(row, offset + 2);
                    if (r > 8 || g > 8 || b > 8)
                    {
                        return false;
                    }
                }
            }

            return true;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static CaptureResult Encode(Bitmap bitmap, string method, string? note)
    {
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return CaptureResult.Success(new CapturedImage(stream.ToArray(), bitmap.Width, bitmap.Height, method, note));
    }
}
