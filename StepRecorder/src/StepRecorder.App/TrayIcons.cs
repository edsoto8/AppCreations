using System.Runtime.InteropServices;
using StepRecorder.Core.Recording;
using Drawing = System.Drawing;
using Drawing2D = System.Drawing.Drawing2D;

namespace StepRecorder.App;

/// <summary>
/// Tray icons drawn in code, one per recording state: a grey dot when idle, a red dot while recording
/// and an amber pause symbol while paused.
/// </summary>
internal sealed class TrayIcons : IDisposable
{
    private readonly Drawing.Icon idle;
    private readonly Drawing.Icon recording;
    private readonly Drawing.Icon paused;

    public TrayIcons()
    {
        int size = System.Windows.Forms.SystemInformation.SmallIconSize.Width;
        idle = Create(size, Drawing.Color.FromArgb(0x76, 0x76, 0x76), pauseBars: false);
        recording = Create(size, Drawing.Color.FromArgb(0xD1, 0x34, 0x38), pauseBars: false);
        paused = Create(size, Drawing.Color.FromArgb(0xC2, 0x7C, 0x0E), pauseBars: true);
    }

    public Drawing.Icon For(RecordingState state) => state switch
    {
        RecordingState.Recording => recording,
        RecordingState.Paused => paused,
        _ => idle,
    };

    public void Dispose()
    {
        idle.Dispose();
        recording.Dispose();
        paused.Dispose();
    }

    private static Drawing.Icon Create(int size, Drawing.Color color, bool pauseBars)
    {
        using var bitmap = new Drawing.Bitmap(size, size, Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = Drawing.Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = Drawing2D.SmoothingMode.AntiAlias;
            graphics.Clear(Drawing.Color.Transparent);

            float inset = size * 0.06f;
            var circle = new Drawing.RectangleF(inset, inset, size - (2 * inset) - 1, size - (2 * inset) - 1);

            // A white rim keeps the dot visible on both light and dark taskbars.
            using var rim = new Drawing.SolidBrush(Drawing.Color.White);
            using var fill = new Drawing.SolidBrush(color);
            graphics.FillEllipse(rim, circle);
            circle.Inflate(-size * 0.1f, -size * 0.1f);
            graphics.FillEllipse(fill, circle);

            if (pauseBars)
            {
                float barWidth = size * 0.13f;
                float barHeight = size * 0.38f;
                float top = (size - barHeight) / 2f;
                float gap = size * 0.1f;
                graphics.FillRectangle(rim, (size / 2f) - gap - barWidth + 0.5f, top, barWidth, barHeight);
                graphics.FillRectangle(rim, (size / 2f) + gap - 0.5f, top, barWidth, barHeight);
            }
        }

        // Icon.FromHandle does not own the handle: clone it into an owned icon, then free the original.
        IntPtr handle = bitmap.GetHicon();
        try
        {
            using Drawing.Icon borrowed = Drawing.Icon.FromHandle(handle);
            return (Drawing.Icon)borrowed.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr handle);
}
