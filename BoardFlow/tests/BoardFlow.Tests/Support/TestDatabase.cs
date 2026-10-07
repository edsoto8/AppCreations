using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Data.Schema;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

namespace BoardFlow.Tests.Support;

/// <summary>
/// A real SQLite file in a fresh temp folder, initialised with the production migrations, plus the
/// repositories over it. <see cref="Reopen"/> simulates an application restart.
/// </summary>
public sealed class TestDatabase : IDisposable
{
    public TestDatabase()
    {
        Directory = Path.Combine(Path.GetTempPath(), "boardflow-tests", Guid.NewGuid().ToString("N"));
        System.IO.Directory.CreateDirectory(Directory);
        DatabasePath = System.IO.Path.Combine(Directory, "boardflow.db");
        Open();
    }

    public string Directory { get; }

    public string DatabasePath { get; }

    public FakeClock Clock { get; } = new();

    public BoardFlowDatabase Database { get; private set; } = null!;

    public WorkspaceRepository Workspaces { get; private set; } = null!;

    public BoardRepository Boards { get; private set; } = null!;

    public ColumnRepository Columns { get; private set; } = null!;

    public CardRepository Cards { get; private set; } = null!;

    public LabelRepository Labels { get; private set; } = null!;

    public SettingsRepository Settings { get; private set; } = null!;

    /// <summary>Drops every pooled connection and builds new repositories over the same file, like a restart.</summary>
    public void Reopen()
    {
        SqliteConnection.ClearAllPools();
        Open();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try
        {
            System.IO.Directory.Delete(Directory, recursive: true);
        }
        catch (IOException)
        {
            // Best effort: a leftover temp folder must not fail a test.
        }
    }

    private void Open()
    {
        Database = new BoardFlowDatabase(DatabasePath);
        new DatabaseInitializer(Database, NullLogger<DatabaseInitializer>.Instance).Initialize();
        Workspaces = new WorkspaceRepository(Database, Clock, NullLogger<WorkspaceRepository>.Instance);
        Boards = new BoardRepository(Database, Clock, NullLogger<BoardRepository>.Instance);
        Columns = new ColumnRepository(Database, Clock, NullLogger<ColumnRepository>.Instance);
        Cards = new CardRepository(Database, Clock, NullLogger<CardRepository>.Instance);
        Labels = new LabelRepository(Database, Clock, NullLogger<LabelRepository>.Instance);
        Settings = new SettingsRepository(Database, Clock, NullLogger<SettingsRepository>.Instance);
    }
}
