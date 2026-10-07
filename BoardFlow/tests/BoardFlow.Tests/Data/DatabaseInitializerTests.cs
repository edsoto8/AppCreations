using System.Security.Cryptography;
using BoardFlow.Data;
using BoardFlow.Data.Schema;
using BoardFlow.Tests.Support;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

namespace BoardFlow.Tests.Data;

public sealed class DatabaseInitializerTests
{
    private static readonly Migration V1 = Migrations.All[0];
    private static readonly Migration V2 = new(2, "Add Extra column", "ALTER TABLE Cards ADD COLUMN Extra TEXT;");

    private static DatabaseInitializer InitializerFor(BoardFlowDatabase database, IReadOnlyList<Migration>? migrations = null) =>
        new(database, NullLogger<DatabaseInitializer>.Instance, migrations);

    private static SqliteConnection OpenRaw(string path) => new($"Data Source={path};Pooling=False");

    private static int UserVersion(string path)
    {
        using var connection = OpenRaw(path);
        return connection.ExecuteScalar<int>("PRAGMA user_version;");
    }

    private static List<string> CardColumns(string path)
    {
        using var connection = OpenRaw(path);
        return connection.Query<string>("SELECT name FROM pragma_table_info('Cards')").AsList();
    }

    private static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));

    /// <summary>Creates a v1 database holding one workspace, board, column and card.</summary>
    private static void CreateV1WithData(TempDirectory dir)
    {
        var database = new BoardFlowDatabase(dir.DatabasePath);
        InitializerFor(database, [V1]).Initialize();
        using var connection = database.Open();
        connection.Execute(
            """
            INSERT INTO Workspaces (Id, Name, CreatedAt, UpdatedAt) VALUES (1, 'Work', 't', 't');
            INSERT INTO Boards (Id, WorkspaceId, Name, SortOrder, CreatedAt, UpdatedAt) VALUES (1, 1, 'Main', 0, 't', 't');
            INSERT INTO BoardColumns (Id, BoardId, Name, SortOrder, CreatedAt, UpdatedAt) VALUES (1, 1, 'Todo', 0, 't', 't');
            INSERT INTO Cards (Id, ColumnId, Title, SortOrder, CreatedAt, UpdatedAt) VALUES (1, 1, 'Keep me', 0, 't', 't');
            """);
    }

    [Fact]
    public void NewFile_IsCreatedAtLatestVersion()
    {
        using var dir = new TempDirectory();
        var database = new BoardFlowDatabase(dir.DatabasePath);

        var result = InitializerFor(database).Initialize();

        Assert.Equal(InitializationOutcome.Created, result.Outcome);
        Assert.Equal(0, result.FromVersion);
        Assert.Equal(Migrations.LatestVersion, result.ToVersion);
        Assert.Null(result.BackupPath);
        Assert.Equal(Migrations.LatestVersion, UserVersion(dir.DatabasePath));

        using var connection = OpenRaw(dir.DatabasePath);
        var tables = connection.Query<string>("SELECT name FROM sqlite_master WHERE type = 'table'").ToHashSet();
        foreach (var expected in new[] { "Workspaces", "Boards", "BoardColumns", "Cards", "Labels", "CardLabels", "AppSettings" })
        {
            Assert.Contains(expected, tables);
        }

        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void NewFile_InMissingFolder_CreatesTheFolder()
    {
        using var dir = new TempDirectory();
        var path = Path.Combine(dir.Path, "nested", "deeper", "boardflow.db");

        var result = InitializerFor(new BoardFlowDatabase(path)).Initialize();

        Assert.Equal(InitializationOutcome.Created, result.Outcome);
        Assert.True(File.Exists(path));
    }

    [Fact]
    public void ZeroByteFile_IsTreatedAsNewAndCreated()
    {
        using var dir = new TempDirectory();
        File.WriteAllBytes(dir.DatabasePath, []);

        var result = InitializerFor(new BoardFlowDatabase(dir.DatabasePath)).Initialize();

        Assert.Equal(InitializationOutcome.Created, result.Outcome);
        Assert.Equal(Migrations.LatestVersion, UserVersion(dir.DatabasePath));
        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void SecondInitialize_IsUpToDateAndPreservesData()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Keep me");

        var result = InitializerFor(db.Database).Initialize();

        Assert.Equal(InitializationOutcome.UpToDate, result.Outcome);
        Assert.Equal(Migrations.LatestVersion, result.FromVersion);
        Assert.Equal(Migrations.LatestVersion, result.ToVersion);
        Assert.Null(result.BackupPath);
        Assert.Equal("Keep me", db.Workspaces.Get(workspace.Id)!.Name);
        Assert.Empty(Directory.GetFiles(db.Directory, "*.bak"));
    }

    [Fact]
    public void DatabaseNewerThanSupported_FailsAndLeavesFileUnchanged()
    {
        using var dir = new TempDirectory();
        InitializerFor(new BoardFlowDatabase(dir.DatabasePath)).Initialize();
        using (var connection = OpenRaw(dir.DatabasePath))
        {
            connection.Execute($"PRAGMA user_version = {Migrations.LatestVersion + 1};");
        }

        SqliteConnection.ClearAllPools();
        var before = Hash(dir.DatabasePath);
        var filesBefore = dir.Files().Order().ToArray();

        var ex = Assert.Throws<PersistenceException>(
            () => InitializerFor(new BoardFlowDatabase(dir.DatabasePath)).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.Contains("newer version", ex.Message);
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Equal(filesBefore, dir.Files().Order().ToArray());
        Assert.Equal(Migrations.LatestVersion + 1, UserVersion(dir.DatabasePath));
    }

    [Fact]
    public void NonSqliteFile_FailsAndIsLeftUntouched()
    {
        using var dir = new TempDirectory();
        var garbage = string.Concat(Enumerable.Repeat("this is definitely not a sqlite database. ", 60));
        File.WriteAllText(dir.DatabasePath, garbage);
        var before = Hash(dir.DatabasePath);

        var ex = Assert.Throws<PersistenceException>(
            () => InitializerFor(new BoardFlowDatabase(dir.DatabasePath)).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.IsType<SqliteException>(ex.InnerException);
        Assert.Contains("It has not been changed", ex.Message);
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Equal(garbage, File.ReadAllText(dir.DatabasePath));
        Assert.Equal([dir.DatabasePath], dir.Files());
    }

    [Fact]
    public void ForeignSqliteDatabase_FailsAndIsLeftUntouched()
    {
        using var dir = new TempDirectory();
        using (var connection = OpenRaw(dir.DatabasePath))
        {
            connection.Execute("CREATE TABLE Recipes (Id INTEGER PRIMARY KEY, Name TEXT); INSERT INTO Recipes (Name) VALUES ('Soup');");
        }

        SqliteConnection.ClearAllPools();
        var before = Hash(dir.DatabasePath);

        Assert.Throws<PersistenceException>(() => InitializerFor(new BoardFlowDatabase(dir.DatabasePath)).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Equal(0, UserVersion(dir.DatabasePath));
    }

    [Fact]
    public void Upgrade_AppliesNewMigrationKeepsDataAndWritesBackup()
    {
        using var dir = new TempDirectory();
        CreateV1WithData(dir);
        Assert.Equal(1, UserVersion(dir.DatabasePath));
        SqliteConnection.ClearAllPools();

        var result = InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, V2]).Initialize();

        Assert.Equal(InitializationOutcome.Upgraded, result.Outcome);
        Assert.Equal(1, result.FromVersion);
        Assert.Equal(2, result.ToVersion);
        Assert.Equal(2, UserVersion(dir.DatabasePath));
        Assert.Contains("Extra", CardColumns(dir.DatabasePath));

        using (var connection = OpenRaw(dir.DatabasePath))
        {
            Assert.Equal("Keep me", connection.ExecuteScalar<string>("SELECT Title FROM Cards WHERE Id = 1"));
            Assert.Equal("Work", connection.ExecuteScalar<string>("SELECT Name FROM Workspaces WHERE Id = 1"));
        }
    }

    [Fact]
    public void Upgrade_BackupIsNextToTheDatabaseAndHoldsThePreUpgradeData()
    {
        using var dir = new TempDirectory();
        CreateV1WithData(dir);
        SqliteConnection.ClearAllPools();

        var result = InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, V2]).Initialize();

        var backups = dir.Files("*.bak");
        var backup = Assert.Single(backups);
        Assert.Equal(backup, result.BackupPath);
        Assert.Equal(dir.Path, Path.GetDirectoryName(backup));

        Assert.Equal(1, UserVersion(backup));
        Assert.DoesNotContain("Extra", CardColumns(backup));
        using var connection = OpenRaw(backup);
        Assert.Equal("Keep me", connection.ExecuteScalar<string>("SELECT Title FROM Cards WHERE Id = 1"));
    }

    [Fact]
    public void Upgrade_ThenInitializeAgain_IsUpToDateWithoutAnotherBackup()
    {
        using var dir = new TempDirectory();
        CreateV1WithData(dir);
        SqliteConnection.ClearAllPools();
        InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, V2]).Initialize();

        var again = InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, V2]).Initialize();

        Assert.Equal(InitializationOutcome.UpToDate, again.Outcome);
        Assert.Single(dir.Files("*.bak"));
    }

    [Fact]
    public void Upgrade_WithFailingMigration_RollsBackAndKeepsBackupAndData()
    {
        using var dir = new TempDirectory();
        CreateV1WithData(dir);
        SqliteConnection.ClearAllPools();
        var broken = new Migration(2, "Broken", "ALTER TABLE Cards ADD COLUMN Extra TEXT; INSERT INTO NoSuchTable VALUES (1);");

        var ex = Assert.Throws<PersistenceException>(
            () => InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, broken]).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.IsType<SqliteException>(ex.InnerException);
        Assert.Equal(1, UserVersion(dir.DatabasePath));
        Assert.DoesNotContain("Extra", CardColumns(dir.DatabasePath));
        Assert.Single(dir.Files("*.bak"));
        using var connection = OpenRaw(dir.DatabasePath);
        Assert.Equal("Keep me", connection.ExecuteScalar<string>("SELECT Title FROM Cards WHERE Id = 1"));
    }

    [Fact]
    public void Upgrade_AppliesSeveralMigrationsInOrder()
    {
        using var dir = new TempDirectory();
        CreateV1WithData(dir);
        SqliteConnection.ClearAllPools();
        var v3 = new Migration(3, "Add Other column", "ALTER TABLE Cards ADD COLUMN Other TEXT DEFAULT 'x';");

        var result = InitializerFor(new BoardFlowDatabase(dir.DatabasePath), [V1, V2, v3]).Initialize();

        Assert.Equal(1, result.FromVersion);
        Assert.Equal(3, result.ToVersion);
        Assert.Equal(3, UserVersion(dir.DatabasePath));
        var columns = CardColumns(dir.DatabasePath);
        Assert.Contains("Extra", columns);
        Assert.Contains("Other", columns);
    }

    [Fact]
    public void Constructor_RejectsEmptyMigrationList()
    {
        using var dir = new TempDirectory();
        var database = new BoardFlowDatabase(dir.DatabasePath);
        Assert.Throws<ArgumentException>(() => InitializerFor(database, []));
    }

    [Fact]
    public void Constructor_RejectsGapInVersions()
    {
        using var dir = new TempDirectory();
        var database = new BoardFlowDatabase(dir.DatabasePath);
        var v3 = new Migration(3, "Skips two", "SELECT 1;");
        Assert.Throws<ArgumentException>(() => InitializerFor(database, [V1, v3]));
    }

    [Fact]
    public void Constructor_RejectsListNotStartingAtOne()
    {
        using var dir = new TempDirectory();
        var database = new BoardFlowDatabase(dir.DatabasePath);
        Assert.Throws<ArgumentException>(() => InitializerFor(database, [V2]));
    }

    [Fact]
    public void Constructor_RejectsDuplicateOrOutOfOrderVersions()
    {
        using var dir = new TempDirectory();
        var database = new BoardFlowDatabase(dir.DatabasePath);
        Assert.Throws<ArgumentException>(() => InitializerFor(database, [V1, V1]));
        Assert.Throws<ArgumentException>(() => InitializerFor(database, [V2, V1]));
    }

    [Fact]
    public void ProductionMigrations_AreContiguousFromOne()
    {
        for (var i = 0; i < Migrations.All.Count; i++)
        {
            Assert.Equal(i + 1, Migrations.All[i].Version);
        }

        Assert.Equal(Migrations.All.Count, Migrations.LatestVersion);
    }
}
