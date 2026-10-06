using StepRecorder.Core.Recording;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

/// <summary>A clock the test moves by hand. Local time is UTC so folder names are predictable.</summary>
internal sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset now = start;

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

    public override DateTimeOffset GetUtcNow() => now;

    public void Advance(TimeSpan by) => now += by;
}

/// <summary>A real temporary folder, deleted when the test ends.</summary>
internal sealed class TempDirectory : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("steprecorder-tests-").FullName;

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // Best effort; the OS cleans its temp folder eventually.
        }
    }
}

/// <summary>Wraps the real store and can be told to fail saves.</summary>
internal sealed class FlakySessionStore(ISessionStore inner) : ISessionStore
{
    public bool FailSaves { get; set; }

    public bool FailScreenshots { get; set; }

    public int SaveCount { get; private set; }

    public string CreateSessionDirectory(string recordingsDirectory, DateTimeOffset startedAt, string name) =>
        inner.CreateSessionDirectory(recordingsDirectory, startedAt, name);

    public void Save(Session session)
    {
        if (FailSaves)
        {
            throw new IOException("Simulated disk failure.");
        }

        SaveCount++;
        inner.Save(session);
    }

    public string SaveScreenshot(Session session, int stepNumber, byte[] png) =>
        FailScreenshots ? throw new IOException("Simulated disk full.") : inner.SaveScreenshot(session, stepNumber, png);

    public void DeleteScreenshot(Session session, string relativePath) => inner.DeleteScreenshot(session, relativePath);

    public Session Load(string sessionDirectory) => inner.Load(sessionDirectory);

    public Session? FindMostRecent(string recordingsDirectory) => inner.FindMostRecent(recordingsDirectory);
}

internal static class TestEnvironment
{
    public static readonly DateTimeOffset Start = new(2026, 10, 5, 17, 57, 0, TimeSpan.Zero);

    public static readonly SessionEnvironment Environment = new("1.2.3", "Windows 11 (test)");
}
