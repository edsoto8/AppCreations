using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Repositories;

/// <summary>
/// Opens a connection per operation (pooled by Microsoft.Data.Sqlite) and turns SQLite failures into a
/// logged <see cref="PersistenceException"/> with a user-facing message. Writes run in one transaction,
/// so a failed multi-statement change leaves nothing half-written.
/// </summary>
public abstract class RepositoryBase(LoanPilotDatabase database, TimeProvider? timeProvider, ILogger logger)
{
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected ILogger Logger { get; } = logger;

    /// <summary>The current time as a UTC <see cref="DateTime"/>, from the injected <see cref="TimeProvider"/>.</summary>
    protected DateTime UtcNow() => _timeProvider.GetUtcNow().UtcDateTime;

    /// <summary>A single-statement read.</summary>
    protected T Read<T>(string operation, Func<SqliteConnection, T> query)
    {
        try
        {
            using var connection = database.Open();
            return query(connection);
        }
        catch (SqliteException ex)
        {
            throw Fail(operation, ex);
        }
    }

    /// <summary>A multi-statement read inside one transaction, so all queries see the same snapshot.</summary>
    protected T ReadSnapshot<T>(string operation, Func<SqliteConnection, SqliteTransaction, T> query)
    {
        try
        {
            using var connection = database.Open();
            using var transaction = connection.BeginTransaction();
            return query(connection, transaction);
        }
        catch (SqliteException ex)
        {
            throw Fail(operation, ex);
        }
    }

    protected T Write<T>(string operation, Func<SqliteConnection, SqliteTransaction, T> change)
    {
        try
        {
            using var connection = database.Open();
            using var transaction = connection.BeginTransaction();
            var result = change(connection, transaction);
            transaction.Commit();
            return result;
        }
        catch (SqliteException ex)
        {
            throw Fail(operation, ex);
        }
    }

    private PersistenceException Fail(string operation, SqliteException ex)
    {
        Logger.LogError(ex, "Database operation '{Operation}' failed (SQLite error {ErrorCode})", operation, ex.SqliteErrorCode);
        return new PersistenceException($"Could not {operation}. Your previous data is unchanged. ({ex.Message})", ex);
    }
}
