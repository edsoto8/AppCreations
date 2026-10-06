using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Storage;

/// <summary>
/// Stores each session as a self-contained folder holding <c>session.json</c> and a
/// <c>screenshots/</c> sub-folder.
/// </summary>
public sealed class FileSessionStore(ILogger? logger = null) : ISessionStore
{
    public const string SessionFileName = "session.json";
    public const string ScreenshotsFolderName = "screenshots";

    private readonly ILogger logger = logger ?? NullLogger.Instance;

    public string CreateSessionDirectory(string recordingsDirectory, DateTimeOffset startedAt, string name)
    {
        string baseName = SessionNaming.FolderName(startedAt, name);
        string path = Path.Combine(recordingsDirectory, baseName);

        for (int suffix = 2; Directory.Exists(path); suffix++)
        {
            path = Path.Combine(recordingsDirectory, $"{baseName}-{suffix}");
        }

        Directory.CreateDirectory(path);
        Directory.CreateDirectory(Path.Combine(path, ScreenshotsFolderName));
        return path;
    }

    public void Save(Session session)
    {
        if (string.IsNullOrEmpty(session.Directory))
        {
            throw new InvalidOperationException("The session has no directory.");
        }

        string json = JsonSerializer.Serialize(session, JsonDefaults.Options);
        AtomicFile.WriteAllText(Path.Combine(session.Directory, SessionFileName), json);
    }

    public static string ScreenshotRelativePath(int stepNumber, ScreenshotFormat format = ScreenshotFormat.Png) =>
        $"{ScreenshotsFolderName}/step-{stepNumber:D3}{Extension(format)}";

    public static string Extension(ScreenshotFormat format) => format == ScreenshotFormat.Jpeg ? ".jpg" : ".png";

    public string SaveScreenshot(Session session, int stepNumber, byte[] data, ScreenshotFormat format = ScreenshotFormat.Png)
    {
        string relative = ScreenshotRelativePath(stepNumber, format);
        string path = ResolveInSession(session.Directory, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, data);
        return relative;
    }

    public void DeleteScreenshot(Session session, string relativePath) =>
        File.Delete(ResolveInSession(session.Directory, relativePath));

    public Session Load(string sessionDirectory)
    {
        string json = File.ReadAllText(Path.Combine(sessionDirectory, SessionFileName));
        Session session = JsonSerializer.Deserialize<Session>(json, JsonDefaults.Options)
            ?? throw new InvalidDataException($"{SessionFileName} is empty.");
        session.Directory = Path.GetFullPath(sessionDirectory);
        return session;
    }

    public Session? FindMostRecent(string recordingsDirectory)
    {
        if (!Directory.Exists(recordingsDirectory))
        {
            return null;
        }

        Session? latest = null;
        foreach (string directory in Directory.EnumerateDirectories(recordingsDirectory))
        {
            if (!File.Exists(Path.Combine(directory, SessionFileName)))
            {
                continue;
            }

            try
            {
                Session session = Load(directory);
                if (latest is null || session.StartedAt > latest.StartedAt)
                {
                    latest = session;
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException or UnauthorizedAccessException)
            {
                logger.LogWarning(ex, "Skipping unreadable session folder {Directory}", directory);
            }
        }

        return latest;
    }

    /// <summary>Turns a relative path from <c>session.json</c> into a full path that must stay inside the session.</summary>
    public static string ResolveInSession(string sessionDirectory, string relativePath)
    {
        string root = Path.GetFullPath(sessionDirectory);
        string full = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"'{relativePath}' is outside the session folder.", nameof(relativePath));
        }

        return full;
    }
}
