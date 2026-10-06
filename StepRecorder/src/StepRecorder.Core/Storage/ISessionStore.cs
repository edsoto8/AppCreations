using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Storage;

public interface ISessionStore
{
    /// <summary>
    /// Creates a new, empty session folder under <paramref name="recordingsDirectory"/> and returns its
    /// absolute path.
    /// </summary>
    string CreateSessionDirectory(string recordingsDirectory, DateTimeOffset startedAt, string name);

    /// <summary>Writes <c>session.json</c> into <see cref="Session.Directory"/>.</summary>
    void Save(Session session);

    /// <summary>
    /// Writes <c>screenshots/step-NNN.png</c>, replacing any file of that name, and returns its path
    /// relative to the session directory (forward slashes).
    /// </summary>
    string SaveScreenshot(Session session, int stepNumber, byte[] png);

    /// <summary>Deletes a screenshot by its relative path. A missing file is not an error.</summary>
    void DeleteScreenshot(Session session, string relativePath);

    /// <summary>Reads <c>session.json</c> from <paramref name="sessionDirectory"/>.</summary>
    Session Load(string sessionDirectory);

    /// <summary>The session with the latest start time, or null when there is none readable.</summary>
    Session? FindMostRecent(string recordingsDirectory);
}
