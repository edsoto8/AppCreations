using System.Drawing;
using System.Drawing.Imaging;
using StepRecorder.Core.Settings;

namespace StepRecorder.Windows;

internal static class ImageEncoding
{
    public static byte[] Encode(Image image, ScreenshotFormat format, int jpegQuality)
    {
        using var stream = new MemoryStream();
        Save(image, stream, format, jpegQuality);
        return stream.ToArray();
    }

    public static void Save(Image image, Stream stream, ScreenshotFormat format, int jpegQuality)
    {
        if (format != ScreenshotFormat.Jpeg)
        {
            image.Save(stream, ImageFormat.Png);
            return;
        }

        ImageCodecInfo jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, (long)Math.Clamp(jpegQuality, 1, 100));
        image.Save(stream, jpeg, parameters);
    }

    public static ScreenshotFormat FormatOf(string path) =>
        Path.GetExtension(path).ToLowerInvariant() is ".jpg" or ".jpeg" ? ScreenshotFormat.Jpeg : ScreenshotFormat.Png;
}
