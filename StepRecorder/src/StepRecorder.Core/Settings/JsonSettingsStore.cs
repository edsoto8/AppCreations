using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Storage;

namespace StepRecorder.Core.Settings;

/// <summary>
/// Loads and saves <see cref="RecorderSettings"/> as JSON. A missing file gives defaults; a corrupt
/// file is kept as <c>.bak</c> for diagnosis and defaults are used.
/// </summary>
public sealed class JsonSettingsStore(string filePath, ILogger? logger = null)
{
    private readonly ILogger logger = logger ?? NullLogger.Instance;

    public string FilePath { get; } = filePath;

    public RecorderSettings Load()
    {
        if (!File.Exists(FilePath))
        {
            return new RecorderSettings();
        }

        try
        {
            string json = File.ReadAllText(FilePath);
            return Normalize(JsonSerializer.Deserialize<RecorderSettings>(json, JsonDefaults.Options));
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Settings file {Path} is corrupt; using defaults", FilePath);
            File.Move(FilePath, FilePath + ".bak", overwrite: true);
            return new RecorderSettings();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Settings file {Path} could not be read; using defaults", FilePath);
            return new RecorderSettings();
        }
    }

    // JSON can contain "section": null, which would otherwise leave a null section behind.
    private static RecorderSettings Normalize(RecorderSettings? settings) =>
        settings is null
            ? new RecorderSettings()
            : settings with
            {
                Recording = settings.Recording ?? new RecordingSettings(),
                Storage = settings.Storage ?? new StorageSettings(),
                Reports = settings.Reports ?? new ReportSettings(),
            };

    public void Save(RecorderSettings settings)
    {
        string? directory = Path.GetDirectoryName(FilePath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        AtomicFile.WriteAllText(FilePath, JsonSerializer.Serialize(settings, JsonDefaults.Options));
    }
}
