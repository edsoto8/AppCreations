using System.Globalization;
using MetroSim.App.Rendering;
using MetroSim.Core.Engine;

namespace MetroSim.App;

/// <summary>
/// Command-line options. Unknown arguments are reported and ignored so a typo never blocks start-up.
/// </summary>
public sealed record AppOptions
{
    public ulong? Seed { get; init; }

    public int MapSize { get; init; } = 128;

    /// <summary>Start with the scripted demo city instead of an empty map.</summary>
    public bool DemoCity { get; init; }

    /// <summary>Let the auto-mayor manage utilities and services for the demo city.</summary>
    public bool AutoMayor { get; init; }

    /// <summary>Save file to open on start-up instead of generating a map.</summary>
    public string? LoadPath { get; init; }

    /// <summary>Simulate this many days before the window opens; fractions are times of day (3.33 = day 4, 08:00).</summary>
    public double WarmupDays { get; init; }

    public SimulationSpeed Speed { get; init; } = SimulationSpeed.Paused;

    public OverlayKind Overlay { get; init; } = OverlayKind.None;

    /// <summary>Close the window after this many seconds and print the measured frame rate.</summary>
    public double? ExitAfterSeconds { get; init; }

    /// <summary>Render this many frames off-screen, print timings and exit (no window).</summary>
    public int? BenchmarkFrames { get; init; }

    public int BenchmarkWidth { get; init; } = 1600;

    public int BenchmarkHeight { get; init; } = 900;

    /// <summary>Pixels per tile for the benchmark camera (and the start-up zoom when set).</summary>
    public double? Zoom { get; init; }

    /// <summary>Folder for quick saves; defaults to the per-user application data folder.</summary>
    public string? SavesDirectory { get; init; }

    public IReadOnlyList<string> Warnings { get; init; } = [];

    private static readonly HashSet<string> TakesValue =
    [
        "--seed", "--size", "--load", "--days", "--speed", "--overlay", "--exit-after", "--resolution", "--zoom", "--saves-dir",
    ];

    public static AppOptions Parse(IReadOnlyList<string> args)
    {
        var options = new AppOptions();
        var warnings = new List<string>();
        for (int i = 0; i < args.Count; i++)
        {
            string arg = args[i];
            string value = "";
            if (TakesValue.Contains(arg))
            {
                if (i + 1 >= args.Count)
                {
                    warnings.Add($"{arg} needs a value.");
                    continue;
                }

                value = args[++i];
            }

            bool valid = true;
            switch (arg)
            {
                case "--seed":
                    valid = ulong.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out ulong seed);
                    options = valid ? options with { Seed = seed } : options;
                    break;
                case "--size":
                    valid = int.TryParse(value, CultureInfo.InvariantCulture, out int size);
                    options = valid ? options with { MapSize = Math.Clamp(size, 32, 512) } : options;
                    break;
                case "--demo":
                    options = options with { DemoCity = true };
                    break;
                case "--auto-mayor":
                    options = options with { DemoCity = true, AutoMayor = true };
                    break;
                case "--load":
                    options = options with { LoadPath = value };
                    break;
                case "--days":
                    valid = double.TryParse(value, CultureInfo.InvariantCulture, out double days);
                    options = valid ? options with { WarmupDays = Math.Clamp(days, 0, 365) } : options;
                    break;
                case "--speed":
                    valid = TryParseSpeed(value, out var speed);
                    options = valid ? options with { Speed = speed } : options;
                    break;
                case "--overlay":
                    valid = Enum.TryParse<OverlayKind>(value, ignoreCase: true, out var overlay);
                    options = valid ? options with { Overlay = overlay } : options;
                    break;
                case "--exit-after":
                    valid = double.TryParse(value, CultureInfo.InvariantCulture, out double seconds);
                    options = valid ? options with { ExitAfterSeconds = Math.Max(0.5, seconds) } : options;
                    break;
                case "--benchmark-render":
                    // Optional frame count: "--benchmark-render" or "--benchmark-render 300".
                    int frames = 300;
                    if (i + 1 < args.Count && int.TryParse(args[i + 1], CultureInfo.InvariantCulture, out int n))
                    {
                        frames = Math.Max(1, n);
                        i++;
                    }

                    options = options with { BenchmarkFrames = frames };
                    break;
                case "--resolution":
                    valid = TryParseSize(value, out int width, out int height);
                    options = valid
                        ? options with { BenchmarkWidth = Math.Clamp(width, 64, 7680), BenchmarkHeight = Math.Clamp(height, 64, 4320) }
                        : options;
                    break;
                case "--zoom":
                    valid = double.TryParse(value, CultureInfo.InvariantCulture, out double zoom);
                    options = valid ? options with { Zoom = Math.Clamp(zoom, Camera.MinZoom, Camera.MaxZoom) } : options;
                    break;
                case "--saves-dir":
                    options = options with { SavesDirectory = value };
                    break;
                default:
                    warnings.Add($"Ignored argument '{arg}'.");
                    break;
            }

            if (!valid)
            {
                warnings.Add($"Invalid value '{value}' for {arg}.");
            }
        }

        return options with { Warnings = warnings };
    }

    private static bool TryParseSize(string value, out int width, out int height)
    {
        height = 0;
        var parts = value.Split('x');
        return int.TryParse(parts[0], CultureInfo.InvariantCulture, out width)
            && parts.Length == 2 && int.TryParse(parts[1], CultureInfo.InvariantCulture, out height);
    }

    private static bool TryParseSpeed(string value, out SimulationSpeed speed)
    {
        speed = value.ToLowerInvariant() switch
        {
            "0" or "pause" or "paused" => SimulationSpeed.Paused,
            "1" or "normal" => SimulationSpeed.Normal,
            "2" or "fast" => SimulationSpeed.Fast,
            "3" or "faster" => SimulationSpeed.Faster,
            "max" or "unlimited" => SimulationSpeed.Unlimited,
            _ => (SimulationSpeed)(-1),
        };
        bool known = Enum.IsDefined(speed);
        speed = known ? speed : SimulationSpeed.Paused;
        return known;
    }
}
