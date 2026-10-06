using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Settings;

namespace StepRecorder.App;

internal static class AppPaths
{
    public static string DataDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StepRecorder");

    public static string SettingsFile { get; } = Path.Combine(DataDirectory, "settings.json");

    public static string LogsDirectory { get; } = Path.Combine(DataDirectory, "logs");

    public static string DefaultRecordingsDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "StepRecorder", "Sessions");

    public static string Version { get; } =
        Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "0.0.0";

    public static SessionEnvironment SessionEnvironment { get; } = new(Version, RuntimeInformation.OSDescription);

    public static string RecordingsDirectory(RecorderSettings settings) =>
        string.IsNullOrWhiteSpace(settings.Storage.RecordingsDirectory)
            ? DefaultRecordingsDirectory
            : settings.Storage.RecordingsDirectory;
}
