using FileImporter.Core.Models;

namespace FileImporter.Core.Abstractions;

/// <summary>Everything the import needs from SQL Server: the tracking table, the staging table and the validation procedure.</summary>
public interface IImportRepository
{
    /// <summary>
    /// Creates a "Processing" tracking record for the file, unless a record for the same content (hash) is already
    /// Processing, Imported or ArchivePending. In that case the existing record is returned with IsNew = false.
    /// <paramref name="importId"/> is the id for a new record; pass the same value when retrying, so a claim that was
    /// committed before a connection drop is recognised as this file's own (IsNew = true).
    /// </summary>
    Task<ImportClaim> BeginImportAsync(Guid importId, string fileName, string fileHash, long fileSizeBytes, CancellationToken cancellationToken);

    /// <summary>
    /// In one transaction: bulk loads the rows into the staging table, runs the validation procedure and, when it
    /// passes, sets the record to Imported. When validation fails everything is rolled back and the result says why.
    /// </summary>
    Task<ValidationResult> LoadAndValidateAsync(Guid importId, ImportFile file, CancellationToken cancellationToken);

    /// <summary>Sets the record to Failed with the error message. Only a Processing record changes: committed imports are never failed.</summary>
    Task MarkFailedAsync(Guid importId, string error, CancellationToken cancellationToken);

    /// <summary>Sets the record to ArchivePending: the data is imported but the file still has to be archived.</summary>
    Task MarkArchivePendingAsync(Guid importId, string error, CancellationToken cancellationToken);

    /// <summary>Records where the file was archived (the first location is kept) and sets the status back to Imported.</summary>
    Task MarkArchivedAsync(Guid importId, string archivePath, CancellationToken cancellationToken);
}
