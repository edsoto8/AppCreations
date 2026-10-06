using StepRecorder.Core.Settings;

namespace StepRecorder.Tests;

public sealed class SettingsTests : IDisposable
{
    private readonly TempDirectory temp = new();

    public void Dispose() => temp.Dispose();

    private string SettingsPath => Path.Combine(temp.Path, "nested", "settings.json");

    [Fact]
    public void Load_WhenFileMissing_ReturnsDefaults()
    {
        RecorderSettings settings = new JsonSettingsStore(SettingsPath).Load();

        Assert.Equal(new RecorderSettings(), settings);
        Assert.Equal(StorageSettings.DefaultName, settings.Storage.DefaultSessionName);
        Assert.True(settings.Recording.CaptureLeftClick);
    }

    [Fact]
    public void SaveThenLoad_RoundTrips()
    {
        var store = new JsonSettingsStore(SettingsPath);
        var settings = new RecorderSettings
        {
            Storage = new StorageSettings { RecordingsDirectory = @"D:\Recordings", DefaultSessionName = "QA" },
            Recording = new RecordingSettings { CaptureRightClick = false },
        };

        store.Save(settings);

        Assert.Equal(settings, store.Load());
    }

    [Fact]
    public void Load_WhenFileCorrupt_ReturnsDefaultsAndKeepsBackup()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, "{ this is not json");

        RecorderSettings settings = new JsonSettingsStore(SettingsPath).Load();

        Assert.Equal(new RecorderSettings(), settings);
        Assert.Equal("{ this is not json", File.ReadAllText(SettingsPath + ".bak"));
        Assert.False(File.Exists(SettingsPath));
    }

    [Fact]
    public void Load_WithMissingOrNullSections_FillsDefaults()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, """{ "recording": null }""");

        RecorderSettings settings = new JsonSettingsStore(SettingsPath).Load();

        Assert.Equal(new RecorderSettings(), settings);
    }
}
