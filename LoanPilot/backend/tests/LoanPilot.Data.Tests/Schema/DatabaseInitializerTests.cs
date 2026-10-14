using System.Security.Cryptography;
using Dapper;
using LoanPilot.Data.Schema;
using LoanPilot.Data.Tests.Support;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

namespace LoanPilot.Data.Tests.Schema;

public sealed class DatabaseInitializerTests
{
    private static readonly Migration V1 = Migrations.All[0];
    private static readonly Migration V2 = new(2, "Add loans.extra", "ALTER TABLE loans ADD COLUMN extra TEXT;");

    private static DatabaseInitializer InitializerFor(LoanPilotDatabase database, params Migration[] migrations) =>
        migrations.Length == 0
            ? new DatabaseInitializer(database, NullLogger<DatabaseInitializer>.Instance)
            : new DatabaseInitializer(database, NullLogger<DatabaseInitializer>.Instance, migrations);

    private static SqliteConnection OpenRaw(string path) => new($"Data Source={path};Pooling=False");

    private static int UserVersion(string path)
    {
        using var connection = OpenRaw(path);
        return connection.ExecuteScalar<int>("PRAGMA user_version;");
    }

    private static List<string> TableNames(string path)
    {
        using var connection = OpenRaw(path);
        return connection.Query<string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").AsList();
    }

    private static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));

    [Fact]
    public void Initialize_NewFile_CreatesDatabaseAtLatestVersion()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);

        var result = InitializerFor(database).Initialize();

        Assert.Equal(InitializationOutcome.Created, result.Outcome);
        Assert.Equal(0, result.FromVersion);
        Assert.Equal(Migrations.LatestVersion, result.ToVersion);
        Assert.Null(result.BackupPath);
        Assert.Equal(Migrations.LatestVersion, UserVersion(dir.DatabasePath));
        Assert.Equal(
            ["loans", "payment_records", "preferences", "scenario_lump_sums", "scenario_recurring_extras", "scenarios"],
            TableNames(dir.DatabasePath));
        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void Initialize_MissingFolder_CreatesIt()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(Path.Combine(dir.Path, "nested", "deeper", "loanpilot.db"));

        InitializerFor(database).Initialize();

        Assert.True(File.Exists(database.DatabasePath));
    }

    [Fact]
    public void Initialize_ZeroByteFile_IsTreatedAsNew()
    {
        using var dir = new TempDirectory();
        File.WriteAllBytes(dir.DatabasePath, []);

        var result = InitializerFor(new LoanPilotDatabase(dir.DatabasePath)).Initialize();

        Assert.Equal(InitializationOutcome.Created, result.Outcome);
        Assert.Equal(Migrations.LatestVersion, UserVersion(dir.DatabasePath));
    }

    [Fact]
    public void Initialize_UpToDateDatabase_LeavesFileUntouched()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);
        InitializerFor(database).Initialize();
        SqliteConnection.ClearAllPools();
        var before = Hash(dir.DatabasePath);

        var result = InitializerFor(database).Initialize();
        SqliteConnection.ClearAllPools();

        Assert.Equal(InitializationOutcome.UpToDate, result.Outcome);
        Assert.Null(result.BackupPath);
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void Initialize_ForeignSqliteDatabase_IsRefusedAndNotModified()
    {
        using var dir = new TempDirectory();
        using (var connection = OpenRaw(dir.DatabasePath))
        {
            connection.Execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES ('keep me');");
        }

        var before = Hash(dir.DatabasePath);
        var database = new LoanPilotDatabase(dir.DatabasePath);

        var ex = Assert.Throws<PersistenceException>(() => InitializerFor(database).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.Contains("not created by LoanPilot", ex.Message);
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Equal(["notes"], TableNames(dir.DatabasePath));
        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void Initialize_NewerSchema_IsRefusedAndNotModified()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);
        InitializerFor(database).Initialize();
        using (var connection = OpenRaw(dir.DatabasePath))
        {
            connection.Execute($"PRAGMA user_version = {Migrations.LatestVersion + 5};");
        }

        SqliteConnection.ClearAllPools();
        var before = Hash(dir.DatabasePath);

        var ex = Assert.Throws<PersistenceException>(() => InitializerFor(database).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.Contains("newer version", ex.Message);
        Assert.Equal(before, Hash(dir.DatabasePath));
        Assert.Equal(Migrations.LatestVersion + 5, UserVersion(dir.DatabasePath));
        Assert.Empty(dir.Files("*.bak"));
    }

    [Fact]
    public void Initialize_FileThatIsNotSqlite_IsRefusedAndNotModified()
    {
        using var dir = new TempDirectory();
        File.WriteAllText(dir.DatabasePath, "this is definitely not a database, just a long enough line of text to look like a file");
        var before = Hash(dir.DatabasePath);

        var ex = Assert.Throws<PersistenceException>(() => InitializerFor(new LoanPilotDatabase(dir.DatabasePath)).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.IsType<SqliteException>(ex.InnerException);
        Assert.Equal(before, Hash(dir.DatabasePath));
    }

    [Fact]
    public void Initialize_OlderSchema_BacksUpThenUpgradesKeepingData()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);
        InitializerFor(database, V1).Initialize();
        using (var connection = database.Open())
        {
            connection.Execute(
                """
                INSERT INTO loans (name, original_amount, apr_percent, term_months, start_date, first_payment_date, created_at, updated_at)
                VALUES ('Keep me', '1000', '5', 12, '2025-01-01', '2025-02-01', 't', 't')
                """);
        }

        var result = InitializerFor(database, V1, V2).Initialize();

        Assert.Equal(InitializationOutcome.Upgraded, result.Outcome);
        Assert.Equal(1, result.FromVersion);
        Assert.Equal(2, result.ToVersion);
        Assert.Equal(2, UserVersion(dir.DatabasePath));

        using (var connection = database.Open())
        {
            Assert.Equal("Keep me", connection.ExecuteScalar<string>("SELECT name FROM loans"));
            Assert.Contains("extra", connection.Query<string>("SELECT name FROM pragma_table_info('loans')").AsList());
        }

        Assert.NotNull(result.BackupPath);
        Assert.True(File.Exists(result.BackupPath));
        Assert.Equal(1, UserVersion(result.BackupPath!));
        using var backup = OpenRaw(result.BackupPath!);
        Assert.Equal("Keep me", backup.ExecuteScalar<string>("SELECT name FROM loans"));
        Assert.DoesNotContain("extra", backup.Query<string>("SELECT name FROM pragma_table_info('loans')").AsList());
    }

    [Fact]
    public void Initialize_FailingMigration_RollsBackAndKeepsExistingData()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);
        InitializerFor(database, V1).Initialize();
        var broken = new Migration(2, "Broken", "ALTER TABLE loans ADD COLUMN ok TEXT; ALTER TABLE no_such_table ADD COLUMN x TEXT;");

        var ex = Assert.Throws<PersistenceException>(() => InitializerFor(database, V1, broken).Initialize());

        SqliteConnection.ClearAllPools();
        Assert.IsType<SqliteException>(ex.InnerException);
        Assert.Equal(1, UserVersion(dir.DatabasePath));
        using var connection = OpenRaw(dir.DatabasePath);
        Assert.DoesNotContain("ok", connection.Query<string>("SELECT name FROM pragma_table_info('loans')").AsList());
    }

    [Fact]
    public void Constructor_MigrationsWithGap_Throws()
    {
        using var dir = new TempDirectory();
        var database = new LoanPilotDatabase(dir.DatabasePath);

        Assert.Throws<ArgumentException>(() => InitializerFor(database, V1, new Migration(3, "Gap", "SELECT 1;")));
    }

    [Fact]
    public void Open_EnablesForeignKeys()
    {
        using var db = new TestDatabase();
        using var connection = db.Database.Open();

        Assert.Equal(1, connection.ExecuteScalar<int>("PRAGMA foreign_keys;"));
    }

    [Fact]
    public void Schema_HasIndexesOnForeignKeyColumns()
    {
        using var db = new TestDatabase();

        var indexed = db.Scalar<long>(
            """
            SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'index' AND name IN (
                'ix_scenarios_loan_id', 'ix_scenario_recurring_extras_scenario_id',
                'ix_scenario_lump_sums_scenario_id', 'ix_payment_records_loan_id')
            """);

        Assert.Equal(4, indexed);
    }
}
