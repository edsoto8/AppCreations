using FileImporter.Core.Abstractions;
using FileImporter.Core.Models;

namespace FileImporter.Tests.TestSupport;

/// <summary>In-memory tracking table that follows the same duplicate rules as the SQL version.</summary>
public sealed class FakeImportRepository : IImportRepository
{
    private static readonly string[] ActiveStatuses = [ImportStatus.Processing, ImportStatus.Imported, ImportStatus.ArchivePending];

    public List<Row> Rows { get; } = [];

    /// <summary>File name → number of rows bulk loaded and committed.</summary>
    public Dictionary<string, int> LoadedRecords { get; } = [];

    public int LoadAttempts { get; private set; }

    /// <summary>Result returned by the "validation procedure" for a given file name. Default: valid.</summary>
    public Func<string, ValidationResult> Validate { get; set; } = _ => ValidationResult.Success;

    /// <summary>Exceptions thrown by the next LoadAndValidateAsync calls, in order.</summary>
    public Queue<Exception> LoadFailures { get; } = new();

    public Row this[string fileName] => Rows.Last(r => r.FileName == fileName);

    public Row Seed(string fileName, string fileHash, string status)
    {
        var row = new Row(Guid.NewGuid(), fileName, fileHash, status, DateTime.UtcNow);
        Rows.Add(row);
        return row;
    }

    public Task<ImportClaim> BeginImportAsync(string fileName, string fileHash, long fileSizeBytes, CancellationToken cancellationToken)
    {
        var existing = Rows.LastOrDefault(r => r.FileHash == fileHash && ActiveStatuses.Contains(r.Status));
        if (existing is not null)
        {
            return Task.FromResult(new ImportClaim(existing.ToRecord(), IsNew: false));
        }

        var row = Seed(fileName, fileHash, ImportStatus.Processing);
        return Task.FromResult(new ImportClaim(row.ToRecord(), IsNew: true));
    }

    public Task<ValidationResult> LoadAndValidateAsync(Guid importId, ImportFile file, CancellationToken cancellationToken)
    {
        LoadAttempts++;
        if (LoadFailures.TryDequeue(out var failure))
        {
            throw failure;
        }

        var row = Find(importId);
        var result = Validate(file.FileName);
        if (result.IsValid)
        {
            // Committed together, like the SQL transaction.
            LoadedRecords[file.FileName] = LoadedRecords.GetValueOrDefault(file.FileName) + file.RecordCount;
            row.Status = ImportStatus.Imported;
            row.RecordCount = file.RecordCount;
        }

        return Task.FromResult(result);
    }

    public Task MarkFailedAsync(Guid importId, string error, CancellationToken cancellationToken)
    {
        var row = Find(importId);
        row.Status = ImportStatus.Failed;
        row.Error = error;
        return Task.CompletedTask;
    }

    public Task MarkArchivePendingAsync(Guid importId, string error, CancellationToken cancellationToken)
    {
        var row = Find(importId);
        row.Status = ImportStatus.ArchivePending;
        row.Error = error;
        return Task.CompletedTask;
    }

    public Task MarkArchivedAsync(Guid importId, string archivePath, CancellationToken cancellationToken)
    {
        var row = Find(importId);
        row.Status = ImportStatus.Imported;
        row.ArchivePath ??= archivePath;
        row.Error = null;
        return Task.CompletedTask;
    }

    private Row Find(Guid importId) => Rows.Single(r => r.ImportId == importId);

    public sealed class Row(Guid importId, string fileName, string fileHash, string status, DateTime startedAtUtc)
    {
        public Guid ImportId { get; } = importId;
        public string FileName { get; } = fileName;
        public string FileHash { get; } = fileHash;
        public string Status { get; set; } = status;
        public DateTime StartedAtUtc { get; } = startedAtUtc;
        public int? RecordCount { get; set; }
        public string? Error { get; set; }
        public string? ArchivePath { get; set; }

        public ImportRecord ToRecord() => new(ImportId, FileName, FileHash, Status, StartedAtUtc);
    }
}
