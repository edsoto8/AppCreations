using System.Drawing;
using System.Drawing.Drawing2D;
using StepRecorder.Core.Reporting;

namespace StepRecorder.Windows;

/// <summary>
/// Burns the click marker into a copy of a screenshot with the same geometry and colors as the HTML
/// report's overlay: a red ring with a light halo, so it shows on both light and dark content.
/// </summary>
public sealed class ScreenshotAnnotator : IScreenshotAnnotator
{
    private const int CopyJpegQuality = 92;

    private static readonly Color Ring = Color.FromArgb(0xE3, 0x26, 0x2F);
    private static readonly Color Halo = Color.FromArgb(217, 255, 255, 255);

    public void DrawClickMarker(string sourcePath, string destinationPath, ClickMarker marker)
    {
        // Copy into a fresh bitmap: drawing on an Image loaded from a file keeps that file locked.
        using var bitmap = LoadCopy(sourcePath);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float radius = (float)marker.Radius;
            var circle = new RectangleF(marker.X - radius, marker.Y - radius, radius * 2, radius * 2);

            using var halo = new Pen(Halo, marker.StrokeWidth + 3);
            using var ring = new Pen(Ring, marker.StrokeWidth);
            graphics.DrawEllipse(halo, circle);
            graphics.DrawEllipse(ring, circle);
        }

        using var output = new FileStream(destinationPath, FileMode.Create, FileAccess.Write);
        ImageEncoding.Save(bitmap, output, ImageEncoding.FormatOf(destinationPath), CopyJpegQuality);
    }

    private static Bitmap LoadCopy(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var original = Image.FromStream(stream);
        var copy = new Bitmap(original.Width, original.Height, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
        using Graphics graphics = Graphics.FromImage(copy);
        graphics.DrawImage(original, 0, 0, original.Width, original.Height);
        return copy;
    }
}
