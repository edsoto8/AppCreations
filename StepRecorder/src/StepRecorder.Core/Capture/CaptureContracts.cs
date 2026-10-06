using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Capture;

/// <summary>A PNG-encoded screenshot held in memory until its step number is known.</summary>
public sealed record CapturedImage(byte[] Png, int Width, int Height, string Method, string? Note = null);

/// <summary>The outcome of a capture attempt: an image, or the reason there is none.</summary>
public sealed record CaptureResult(CapturedImage? Image, string? FailureReason)
{
    public static CaptureResult Success(CapturedImage image) => new(image, null);

    public static CaptureResult Failed(string reason) => new(null, reason);
}

/// <summary>
/// Captures one top-level window (not the desktop; docs/decisions/0003). Implementations should return
/// <see cref="CaptureResult.Failed"/> for expected failures, but callers also handle exceptions.
/// </summary>
public interface IWindowCapture
{
    CaptureResult Capture(WindowInfo window);
}

/// <summary>What to attach to a new step: a captured image, or why there is none.</summary>
public sealed record StepScreenshot(ScreenshotStatus Status, CapturedImage? Image, string? Note)
{
    public static StepScreenshot Captured(CapturedImage image) => new(ScreenshotStatus.Captured, image, image.Note);

    public static StepScreenshot Unavailable(string reason) => new(ScreenshotStatus.Unavailable, null, reason);

    public static StepScreenshot Skipped(string reason) => new(ScreenshotStatus.Skipped, null, reason);
}
