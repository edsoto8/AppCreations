using Microsoft.Data.Sqlite;

namespace BoardFlow.Tests.Support;

/// <summary>A fresh temp folder for tests that manage the database file themselves.</summary>
public sealed class TempDirectory : IDisposable
{
    public TempDirectory()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "boardflow-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string DatabasePath => System.IO.Path.Combine(Path, "boardflow.db");

    public string[] Files(string pattern = "*") => Directory.GetFiles(Path, pattern);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // Best effort: a leftover temp folder must not fail a test.
        }
    }
}
