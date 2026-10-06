using BoardFlow.Core;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

/// <summary>
/// Opens a connection per operation (pooled by Microsoft.Data.Sqlite) and turns SQLite failures into a
/// logged <see cref="PersistenceException"/> with a user-facing message. Writes run in one transaction,
/// so a failed multi-statement change leaves nothing half-written.
/// </summary>
public abstract class RepositoryBase(BoardFlowDatabase database, IClock clock, ILogger logger)
{
    protected IClock Clock { get; } = clock;

    protected ILogger Logger { get; } = logger;

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

    protected void Write(string operation, Action<SqliteConnection, SqliteTransaction> change) =>
        Write<object?>(operation, (c, t) =>
        {
            change(c, t);
            return null;
        });

    private PersistenceException Fail(string operation, SqliteException ex)
    {
        Logger.LogError(ex, "Database operation '{Operation}' failed (SQLite error {ErrorCode})", operation, ex.SqliteErrorCode);
        return new PersistenceException($"Could not {operation}. Your previous data is unchanged. ({ex.Message})", ex);
    }

    protected static NotFoundException Missing(string what, long id) => new($"{what} {id} no longer exists.");
}
