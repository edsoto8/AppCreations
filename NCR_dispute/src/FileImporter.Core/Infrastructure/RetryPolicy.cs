using System.Data.Common;
using System.Net.Sockets;
using FileImporter.Core.Configuration;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FileImporter.Core.Infrastructure;

/// <summary>
/// Retries an operation when it fails with a transient error (SQL Server connection drops, deadlocks, timeouts,
/// file locks, network errors). Waits <see cref="RetryOptions.InitialDelaySeconds"/> and doubles the wait each time.
/// Only wrap operations that are safe to repeat.
/// </summary>
public sealed class RetryPolicy(IOptions<RetryOptions> options, TimeProvider timeProvider, ILogger<RetryPolicy> logger)
{
    // SQL Server / Azure SQL errors that are worth another attempt.
    private static readonly HashSet<int> TransientSqlErrors =
    [
        -2,     // Client timeout
        20,     // Instance does not support encryption (seen during failover)
        64,     // Connection error
        233,    // Connection initialization error
        1205,   // Deadlock victim
        10053,  // Transport-level error
        10054,  // Connection forcibly closed
        10060,  // Network timeout
        10928,  // Resource limit reached
        10929,  // Resource limit reached
        40143,  // Azure SQL: connection could not be initialized
        40197,  // Azure SQL: service error
        40501,  // Azure SQL: service busy
        40613,  // Azure SQL: database unavailable
        49918, 49919, 49920, // Azure SQL: too many operations
    ];

    public Task ExecuteAsync(string operation, Func<CancellationToken, Task> action, CancellationToken cancellationToken) =>
        ExecuteAsync<object?>(operation, async ct =>
        {
            await action(ct).ConfigureAwait(false);
            return null;
        }, cancellationToken);

    public async Task<T> ExecuteAsync<T>(string operation, Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken)
    {
        var maxAttempts = Math.Max(1, options.Value.MaxAttempts);
        var delay = TimeSpan.FromSeconds(Math.Max(0, options.Value.InitialDelaySeconds));

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await action(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (attempt < maxAttempts && IsTransient(ex) && !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex,
                    "Transient error during {Operation} (attempt {Attempt} of {MaxAttempts}); retrying in {DelaySeconds}s",
                    operation, attempt, maxAttempts, delay.TotalSeconds);

                if (delay > TimeSpan.Zero)
                {
                    await Task.Delay(delay, timeProvider, cancellationToken).ConfigureAwait(false);
                }

                delay *= 2;
            }
        }
    }

    public static bool IsTransient(Exception ex) => ex switch
    {
        SqlException sql => sql.Errors.Cast<SqlError>().Any(e => TransientSqlErrors.Contains(e.Number)),
        DbException db => db.IsTransient,
        TimeoutException or SocketException => true,
        FileNotFoundException or DirectoryNotFoundException or PathTooLongException => false,
        IOException => true, // e.g. file locked by another process
        _ => false,
    };
}
