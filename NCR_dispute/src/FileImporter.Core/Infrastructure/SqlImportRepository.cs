using System.Data;
using Dapper;
using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using FileImporter.Core.Models;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FileImporter.Core.Infrastructure;

/// <summary>
/// SQL Server implementation: tracking table via Dapper, staging table via SqlBulkCopy, validation procedure via Dapper.
/// The tracking table and its columns are defined in sql/01_FileImport.sql; change both together.
/// </summary>
public sealed class SqlImportRepository(IOptions<DatabaseOptions> databaseOptions, IOptions<ImportOptions> importOptions) : IImportRepository
{
    private const string TrackingTable = "dbo.FileImport";

    private const int MaxErrorLength = 4000;

    private DatabaseOptions Db => databaseOptions.Value;

    public async Task<ImportClaim> BeginImportAsync(string fileName, string fileHash, long fileSizeBytes, CancellationToken cancellationToken)
    {
        // One batch, one transaction: the UPDLOCK/HOLDLOCK read stops two runs from claiming the same file at once.
        // A filtered unique index on FileHash (see sql/01_FileImport.sql) is the backstop.
        const string sql = $"""
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;

            UPDATE {TrackingTable}
            SET Status = '{ImportStatus.Failed}',
                ErrorMessage = N'Abandoned: still Processing after the timeout. A later run retried the file.',
                CompletedAtUtc = SYSUTCDATETIME()
            WHERE FileHash = @FileHash
              AND Status = '{ImportStatus.Processing}'
              AND StartedAtUtc < DATEADD(MINUTE, -@TimeoutMinutes, SYSUTCDATETIME());

            DECLARE @ExistingId UNIQUEIDENTIFIER;
            SELECT TOP (1) @ExistingId = ImportId
            FROM {TrackingTable} WITH (UPDLOCK, HOLDLOCK)
            WHERE FileHash = @FileHash
              AND Status IN ('{ImportStatus.Processing}', '{ImportStatus.Imported}', '{ImportStatus.ArchivePending}')
            ORDER BY StartedAtUtc DESC;

            IF @ExistingId IS NULL
            BEGIN
                INSERT INTO {TrackingTable} (ImportId, FileName, FileHash, FileSizeBytes, Status, StartedAtUtc, MachineName)
                VALUES (@ImportId, @FileName, @FileHash, @FileSizeBytes, '{ImportStatus.Processing}', SYSUTCDATETIME(), @MachineName);
                SET @ExistingId = @ImportId;
            END;

            COMMIT TRANSACTION;

            SELECT ImportId, FileName, FileHash, Status, StartedAtUtc
            FROM {TrackingTable}
            WHERE ImportId = @ExistingId;
            """;

        var newId = Guid.NewGuid();
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        var record = await connection.QuerySingleAsync<ImportRecord>(Command(sql, new
        {
            ImportId = newId,
            FileName = fileName,
            FileHash = fileHash,
            FileSizeBytes = fileSizeBytes,
            TimeoutMinutes = Math.Max(1, importOptions.Value.ProcessingTimeoutMinutes),
            Environment.MachineName,
        }, cancellationToken: cancellationToken)).ConfigureAwait(false);

        return new ImportClaim(record, IsNew: record.ImportId == newId);
    }

    public async Task<ValidationResult> LoadAndValidateAsync(Guid importId, ImportFile file, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);

        // Lock the tracking row. If an earlier attempt already committed (e.g. the connection dropped while the
        // commit was being acknowledged and the retry policy called us again), do not load the rows a second time.
        var status = await connection.QuerySingleOrDefaultAsync<string>(Command(
            $"SELECT Status FROM {TrackingTable} WITH (UPDLOCK, ROWLOCK) WHERE ImportId = @ImportId;",
            new { ImportId = importId }, transaction, cancellationToken)).ConfigureAwait(false);

        switch (status)
        {
            case null:
                throw new InvalidOperationException($"Import {importId} was not found in {TrackingTable}.");
            case ImportStatus.Imported:
                return ValidationResult.Success;
            case not ImportStatus.Processing:
                throw new InvalidOperationException($"Import {importId} has status {status}; expected {ImportStatus.Processing}.");
        }

        await BulkLoadAsync(connection, transaction, importId, file.Data, cancellationToken).ConfigureAwait(false);

        var result = await RunValidationProcedureAsync(connection, transaction, importId, cancellationToken).ConfigureAwait(false);
        if (!result.IsValid)
        {
            await transaction.RollbackAsync(cancellationToken).ConfigureAwait(false);
            return result;
        }

        await connection.ExecuteAsync(Command($"""
            UPDATE {TrackingTable}
            SET Status = '{ImportStatus.Imported}', RecordCount = @RecordCount, CompletedAtUtc = SYSUTCDATETIME(), ErrorMessage = NULL
            WHERE ImportId = @ImportId;
            """, new { ImportId = importId, file.RecordCount }, transaction, cancellationToken)).ConfigureAwait(false);

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    public Task MarkFailedAsync(Guid importId, string error, CancellationToken cancellationToken) =>
        ExecuteAsync($"""
            UPDATE {TrackingTable}
            SET Status = '{ImportStatus.Failed}', ErrorMessage = @Error, CompletedAtUtc = SYSUTCDATETIME()
            WHERE ImportId = @ImportId;
            """, new { ImportId = importId, Error = Truncate(error) }, cancellationToken);

    public Task MarkArchivePendingAsync(Guid importId, string error, CancellationToken cancellationToken) =>
        ExecuteAsync($"""
            UPDATE {TrackingTable}
            SET Status = '{ImportStatus.ArchivePending}', ErrorMessage = @Error
            WHERE ImportId = @ImportId;
            """, new { ImportId = importId, Error = Truncate(error) }, cancellationToken);

    public Task MarkArchivedAsync(Guid importId, string archivePath, CancellationToken cancellationToken) =>
        ExecuteAsync($"""
            UPDATE {TrackingTable}
            SET Status = '{ImportStatus.Imported}', ErrorMessage = NULL,
                -- Keep the first archive location when a duplicate copy of the file is archived later.
                ArchivePath = COALESCE(ArchivePath, @ArchivePath), ArchivedAtUtc = COALESCE(ArchivedAtUtc, SYSUTCDATETIME())
            WHERE ImportId = @ImportId;
            """, new { ImportId = importId, ArchivePath = archivePath }, cancellationToken);

    private async Task BulkLoadAsync(SqlConnection connection, SqlTransaction transaction, Guid importId, DataTable data, CancellationToken cancellationToken)
    {
        // Add the import id (and row number) columns so every staging row can be traced back to its file.
        // Guarded with Contains because a retried attempt gets the same DataTable again.
        if (!data.Columns.Contains(Db.ImportIdColumn))
        {
            data.Columns.Add(Db.ImportIdColumn, typeof(Guid));
        }

        var rowNumberColumn = string.IsNullOrWhiteSpace(Db.RowNumberColumn) ? null : Db.RowNumberColumn;
        if (rowNumberColumn is not null && !data.Columns.Contains(rowNumberColumn))
        {
            data.Columns.Add(rowNumberColumn, typeof(int));
        }

        for (var i = 0; i < data.Rows.Count; i++)
        {
            data.Rows[i][Db.ImportIdColumn] = importId;
            if (rowNumberColumn is not null)
            {
                data.Rows[i][rowNumberColumn] = i + 1;
            }
        }

        using var bulkCopy = new SqlBulkCopy(connection, SqlBulkCopyOptions.CheckConstraints, transaction)
        {
            DestinationTableName = Db.StagingTable,
            BatchSize = Db.BulkCopyBatchSize,
            BulkCopyTimeout = Db.BulkCopyTimeoutSeconds,
        };

        // Map by name so the staging table's column order does not matter.
        foreach (DataColumn column in data.Columns)
        {
            bulkCopy.ColumnMappings.Add(column.ColumnName, column.ColumnName);
        }

        await bulkCopy.WriteToServerAsync(data, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Runs the validation procedure with @ImportId. It fails the import by returning a row with IsValid = 0
    /// (and a Message) or by raising an error (THROW / RAISERROR). No result set means the data is valid.
    /// </summary>
    private async Task<ValidationResult> RunValidationProcedureAsync(SqlConnection connection, SqlTransaction transaction, Guid importId, CancellationToken cancellationToken)
    {
        try
        {
            var row = await connection.QueryFirstOrDefaultAsync<ValidationRow>(Command(
                Db.ValidationProcedure, new { ImportId = importId }, transaction, cancellationToken, CommandType.StoredProcedure)).ConfigureAwait(false);

            return row is null || row.IsValid
                ? ValidationResult.Success
                : ValidationResult.Failure(string.IsNullOrWhiteSpace(row.Message) ? "The validation procedure rejected the file." : row.Message);
        }
        catch (SqlException ex) when (ex.Number >= 50000)
        {
            // A user-defined error raised by the procedure is a validation failure, not an infrastructure error.
            return ValidationResult.Failure(ex.Message);
        }
    }

    private async Task ExecuteAsync(string sql, object parameters, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await connection.ExecuteAsync(Command(sql, parameters, cancellationToken: cancellationToken)).ConfigureAwait(false);
    }

    private async Task<SqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(Db.ConnectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private CommandDefinition Command(string sql, object parameters, SqlTransaction? transaction = null,
        CancellationToken cancellationToken = default, CommandType commandType = CommandType.Text) =>
        new(sql, parameters, transaction, Db.CommandTimeoutSeconds, commandType, cancellationToken: cancellationToken);

    private static string Truncate(string value) => value.Length <= MaxErrorLength ? value : value[..(MaxErrorLength - 3)] + "...";

    private sealed class ValidationRow
    {
        public bool IsValid { get; set; }

        public string? Message { get; set; }
    }
}
