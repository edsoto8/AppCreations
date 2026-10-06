using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Schema;

public enum InitializationOutcome
{
    Created,
    Upgraded,
    UpToDate,
}

public sealed record InitializationResult(InitializationOutcome Outcome, int FromVersion, int ToVersion, string? BackupPath);

/// <summary>
/// Creates the database on first run and applies pending migrations. It never deletes or recreates an
/// existing file: an unreadable, corrupt or newer-than-supported database stops start-up with an error.
/// Before upgrading an existing database a copy is saved next to it.
/// </summary>
public sealed class DatabaseInitializer(
    BoardFlowDatabase database,
    ILogger<DatabaseInitializer> logger,
    IReadOnlyList<Migration>? migrations = null)
{
    private readonly IReadOnlyList<Migration> _migrations = Validated(migrations ?? Migrations.All);

    public InitializationResult Initialize()
    {
        var path = database.DatabasePath;
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var isNewFile = !File.Exists(path) || new FileInfo(path).Length == 0;
        var latest = _migrations[^1].Version;

        try
        {
            int current;
            using (var connection = database.Open())
            {
                // Reading the header also proves the file is a SQLite database.
                current = connection.ExecuteScalar<int>("PRAGMA user_version;");
                if (current > latest)
                {
                    throw new PersistenceException(
                        $"The database at {path} was created by a newer version of BoardFlow (schema {current}, " +
                        $"this version supports {latest}). It has not been changed.");
                }

                if (!isNewFile)
                {
                    var check = connection.ExecuteScalar<string>("PRAGMA quick_check;");
                    if (!string.Equals(check, "ok", StringComparison.OrdinalIgnoreCase))
                    {
                        throw new PersistenceException(
                            $"The database at {path} failed its integrity check ({check}). It has not been changed.");
                    }
                }
            }

            if (current == latest)
            {
                logger.LogInformation("Database {Path} is up to date at schema {Version}", path, current);
                return new InitializationResult(InitializationOutcome.UpToDate, current, current, null);
            }

            string? backupPath = null;
            if (!isNewFile && current > 0)
            {
                backupPath = Backup(path, current);
            }

            using (var connection = database.Open())
            {
                foreach (var migration in _migrations.Where(m => m.Version > current))
                {
                    Apply(connection, migration);
                }
            }

            var outcome = current == 0 && isNewFile ? InitializationOutcome.Created : InitializationOutcome.Upgraded;
            logger.LogInformation(
                "Database {Path} {Outcome} from schema {From} to {To}", path, outcome, current, latest);
            return new InitializationResult(outcome, current, latest, backupPath);
        }
        catch (SqliteException ex)
        {
            logger.LogError(ex, "Could not open or migrate database {Path}", path);
            throw new PersistenceException(
                $"The database at {path} could not be opened ({ex.Message}). It has not been changed.", ex);
        }
    }

    private void Apply(SqliteConnection connection, Migration migration)
    {
        using var transaction = connection.BeginTransaction();
        connection.Execute(migration.Sql, transaction: transaction);

        // PRAGMA does not accept parameters; the version is an int we control.
        connection.Execute($"PRAGMA user_version = {migration.Version};", transaction: transaction);
        transaction.Commit();
        logger.LogInformation("Applied migration {Version}: {Description}", migration.Version, migration.Description);
    }

    private string Backup(string path, int version)
    {
        var backupPath = $"{path}.v{version}-{DateTime.UtcNow:yyyyMMddHHmmss}.bak";

        // VACUUM INTO writes a consistent copy even if another connection holds the file open.
        using var connection = database.Open();
        connection.Execute("VACUUM INTO @backupPath;", new { backupPath });
        logger.LogInformation("Backed up database before upgrade to {BackupPath}", backupPath);
        return backupPath;
    }

    private static IReadOnlyList<Migration> Validated(IReadOnlyList<Migration> migrations)
    {
        if (migrations.Count == 0)
        {
            throw new ArgumentException("At least one migration is required.", nameof(migrations));
        }

        for (var i = 0; i < migrations.Count; i++)
        {
            if (migrations[i].Version != i + 1)
            {
                throw new ArgumentException("Migration versions must be 1, 2, 3, ... with no gaps.", nameof(migrations));
            }
        }

        return migrations;
    }
}
