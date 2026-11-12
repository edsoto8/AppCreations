using System.Globalization;
using Dapper;
using Microsoft.Data.Sqlite;

namespace DotNet11Lab.Core.Labs.Performance;

/// <summary>A live measurement as stored in the run journal.</summary>
public sealed record JournalEntry(
    long Id,
    string RunId,
    DateTimeOffset RecordedUtc,
    string Runtime,
    string Build,
    string Machine,
    string GroupId,
    string Workload,
    int Iterations,
    double MeanMicroseconds,
    double AllocatedBytesPerOp,
    double OpsPerSecond);

/// <summary>
/// Small SQLite "run journal" (Dapper + Microsoft.Data.Sqlite) so live measurements can be compared across sessions
/// and restarts. This is the lab's only persistence. The table is capped at <see cref="MaxRows"/> rows.
/// </summary>
public sealed class PerformanceJournal(string databasePath)
{
    public const string ConfigurationKey = "PerformanceLab:JournalPath";
    public const int MaxRows = 5_000;
    public const int MaxQueryLimit = 1_000;

    private readonly SemaphoreSlim _initLock = new(1, 1);
    private bool _initialized;

    public string DatabasePath { get; } = Path.GetFullPath(databasePath);

    /// <summary>Whether the database file exists yet (it is created by the first <see cref="RecordAsync"/>).</summary>
    public bool Exists => File.Exists(DatabasePath);

    // Pooling off: the journal is written a handful of times per session, and an unpooled connection releases the
    // file as soon as it is disposed (simple backups, clean deletes in tests).
    private string ConnectionString => new SqliteConnectionStringBuilder
    {
        DataSource = DatabasePath,
        Mode = SqliteOpenMode.ReadWriteCreate,
        Pooling = false,
    }.ToString();

    // <snippet:Perf.JournalSchema>
    private const string Schema = """
        CREATE TABLE IF NOT EXISTS perf_runs (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id                 TEXT    NOT NULL,
            recorded_utc           TEXT    NOT NULL,
            runtime                TEXT    NOT NULL,
            build                  TEXT    NOT NULL,
            machine                TEXT    NOT NULL,
            group_id               TEXT    NOT NULL,
            workload               TEXT    NOT NULL,
            iterations             INTEGER NOT NULL,
            mean_us                REAL    NOT NULL,
            allocated_bytes_per_op REAL    NOT NULL,
            ops_per_second         REAL    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_perf_runs_workload ON perf_runs (group_id, workload, recorded_utc);
        """;
    // </snippet:Perf.JournalSchema>

    private async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        if (!_initialized)
        {
            await _initLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!_initialized)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
                    await using var init = new SqliteConnection(ConnectionString);
                    await init.OpenAsync(cancellationToken).ConfigureAwait(false);
                    await init.ExecuteAsync(new CommandDefinition(Schema, cancellationToken: cancellationToken)).ConfigureAwait(false);
                    _initialized = true;
                }
            }
            finally
            {
                _initLock.Release();
            }
        }
        var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        return connection;
    }

    // <snippet:Perf.JournalRecord>
    public async Task RecordAsync(LiveRun run, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(run);
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        const string insert = """
            INSERT INTO perf_runs (run_id, recorded_utc, runtime, build, machine, group_id, workload, iterations, mean_us, allocated_bytes_per_op, ops_per_second)
            VALUES (@RunId, @RecordedUtc, @Runtime, @Build, @Machine, @GroupId, @Workload, @Iterations, @MeanMicroseconds, @AllocatedBytesPerOp, @OpsPerSecond);
            """;
        var rows = run.Results.Select(r => new
        {
            run.RunId,
            RecordedUtc = run.StartedUtc.ToString("O", CultureInfo.InvariantCulture),
            run.Runtime,
            run.Build,
            run.Machine,
            r.GroupId,
            r.Workload,
            r.Iterations,
            r.MeanMicroseconds,
            r.AllocatedBytesPerOp,
            r.OpsPerSecond,
        });
        await connection.ExecuteAsync(new CommandDefinition(insert, rows, tx, cancellationToken: cancellationToken)).ConfigureAwait(false);
        // Keep the journal small: drop the oldest rows beyond the cap.
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM perf_runs WHERE id <= (SELECT id FROM perf_runs ORDER BY id DESC LIMIT 1 OFFSET @MaxRows);",
            new { MaxRows }, tx, cancellationToken: cancellationToken)).ConfigureAwait(false);
        await tx.CommitAsync(cancellationToken).ConfigureAwait(false);
    }
    // </snippet:Perf.JournalRecord>

    /// <summary>Most recent entries first, optionally for one workload group.</summary>
    public async Task<IReadOnlyList<JournalEntry>> GetRecentAsync(int limit, string? groupId = null, CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, MaxQueryLimit);
        if (!Exists) return []; // reading never creates the database; only recording a run does
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition("""
            SELECT id AS Id, run_id AS RunId, recorded_utc AS RecordedUtc, runtime AS Runtime, build AS Build, machine AS Machine,
                   group_id AS GroupId, workload AS Workload, iterations AS Iterations, mean_us AS MeanMicroseconds,
                   allocated_bytes_per_op AS AllocatedBytesPerOp, ops_per_second AS OpsPerSecond
            FROM perf_runs
            WHERE @GroupId IS NULL OR group_id = @GroupId
            ORDER BY id DESC
            LIMIT @Limit;
            """, new { GroupId = groupId, Limit = limit }, cancellationToken: cancellationToken)).ConfigureAwait(false);
        return rows.Select(r => r.ToEntry()).ToList();
    }

    public async Task<int> CountAsync(CancellationToken cancellationToken = default)
    {
        if (!Exists) return 0;
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM perf_runs;", cancellationToken: cancellationToken)).ConfigureAwait(false);
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        if (!Exists) return;
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await connection.ExecuteAsync(new CommandDefinition("DELETE FROM perf_runs;", cancellationToken: cancellationToken)).ConfigureAwait(false);
    }

    private sealed class Row
    {
        public long Id { get; set; }
        public string RunId { get; set; } = "";
        public string RecordedUtc { get; set; } = "";
        public string Runtime { get; set; } = "";
        public string Build { get; set; } = "";
        public string Machine { get; set; } = "";
        public string GroupId { get; set; } = "";
        public string Workload { get; set; } = "";
        public long Iterations { get; set; }
        public double MeanMicroseconds { get; set; }
        public double AllocatedBytesPerOp { get; set; }
        public double OpsPerSecond { get; set; }

        public JournalEntry ToEntry() => new(Id, RunId, DateTimeOffset.Parse(RecordedUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
            Runtime, Build, Machine, GroupId, Workload, (int)Iterations, MeanMicroseconds, AllocatedBytesPerOp, OpsPerSecond);
    }
}
