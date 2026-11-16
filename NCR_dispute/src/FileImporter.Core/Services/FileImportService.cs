using System.Diagnostics;
using System.Security.Cryptography;
using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Core.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FileImporter.Core.Services;

/// <summary>
/// Runs the import workflow over the source folder. Each file is processed on its own, so one bad file does not
/// stop the others:
/// hash file → claim it in the tracking table (duplicate check) → read and check structure →
/// bulk load + validation procedure + mark Imported (one transaction) → move to archive.
/// A file is only archived after its data is committed; a failed file stays where it is.
/// </summary>
public sealed class FileImportService(
    IImportFileReader reader,
    IImportRepository repository,
    IFileArchiver archiver,
    INotificationService notifier,
    RetryPolicy retryPolicy,
    IOptions<ImportOptions> options,
    TimeProvider timeProvider,
    ILogger<FileImportService> logger)
{
    private const int MaxErrorsInSummary = 20;

    public async Task<ImportRunSummary> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        IReadOnlyList<string> files;
        try
        {
            files = FindFiles();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Cannot list files in {SourceDirectory}", settings.SourceDirectory);
            await SendAlertAsync(new ImportAlert("(none)", null, "Finding files", ex.Message, timeProvider.GetLocalNow()), cancellationToken).ConfigureAwait(false);
            throw;
        }

        logger.LogInformation("Found {FileCount} file(s) matching {FilePattern} in {SourceDirectory}",
            files.Count, settings.FilePattern, settings.SourceDirectory);

        var outcomes = new List<ImportOutcome>();
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            outcomes.Add(await ProcessFileAsync(file, cancellationToken).ConfigureAwait(false));
        }

        var summary = new ImportRunSummary(outcomes);
        logger.LogInformation(
            "Run finished: {FileCount} file(s), {ImportedCount} imported, {AlreadyImportedCount} already imported, {FailureCount} failed or pending archive",
            outcomes.Count,
            outcomes.Count(o => o.Kind == ImportResultKind.Imported),
            outcomes.Count(o => o.Kind == ImportResultKind.AlreadyImported),
            summary.FailureCount);
        return summary;
    }

    /// <summary>Files in the source folder (not subfolders) that match the pattern and are old enough to be complete.</summary>
    internal IReadOnlyList<string> FindFiles()
    {
        var settings = options.Value;
        var cutoff = timeProvider.GetUtcNow().UtcDateTime.AddSeconds(-Math.Max(0, settings.MinFileAgeSeconds));
        var files = new List<string>();

        foreach (var path in Directory.EnumerateFiles(settings.SourceDirectory, settings.FilePattern, SearchOption.TopDirectoryOnly).Order(StringComparer.OrdinalIgnoreCase))
        {
            if (File.GetLastWriteTimeUtc(path) > cutoff)
            {
                logger.LogInformation("Skipping {FileName}: changed less than {MinFileAgeSeconds}s ago, it may still be copying",
                    Path.GetFileName(path), settings.MinFileAgeSeconds);
                continue;
            }

            files.Add(path);
        }

        return files;
    }

    /// <summary>Processes one file. Never throws, except when the run is cancelled.</summary>
    public async Task<ImportOutcome> ProcessFileAsync(string path, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(path);
        var stopwatch = Stopwatch.StartNew();
        using var scope = logger.BeginScope(new Dictionary<string, object> { ["FileName"] = fileName });

        Guid? importId = null;
        var recordCount = 0;
        var stage = "Reading file";
        try
        {
            logger.LogInformation("Processing {FileName}", fileName);
            var (hash, size) = await HashFileAsync(path, cancellationToken).ConfigureAwait(false);

            stage = "Starting import";
            var claim = await retryPolicy.ExecuteAsync("start import",
                ct => repository.BeginImportAsync(fileName, hash, size, ct), cancellationToken).ConfigureAwait(false);
            if (!claim.IsNew)
            {
                return await HandleExistingImportAsync(path, claim.Record, stopwatch, cancellationToken).ConfigureAwait(false);
            }

            importId = claim.Record.ImportId;
            logger.LogInformation("Started import {ImportId} for {FileName} (SHA-256 {FileHash})", importId, fileName, hash);

            stage = "File validation";
            using var file = await reader.ReadAsync(path, cancellationToken).ConfigureAwait(false);
            recordCount = file.RecordCount;
            if (!file.IsValid)
            {
                return await FailAsync(fileName, importId, recordCount, stopwatch, stage, Summarize(file.Errors), null, cancellationToken).ConfigureAwait(false);
            }

            stage = "Database import";
            var validation = await retryPolicy.ExecuteAsync("bulk load and validation",
                ct => repository.LoadAndValidateAsync(importId.Value, file, ct), cancellationToken).ConfigureAwait(false);
            if (!validation.IsValid)
            {
                return await FailAsync(fileName, importId, recordCount, stopwatch, "Database validation",
                    validation.Message ?? "The validation procedure rejected the file.", null, cancellationToken).ConfigureAwait(false);
            }

            logger.LogInformation("Imported {RecordCount} record(s) from {FileName} as {ImportId}", recordCount, fileName, importId);
            return await ArchiveAsync(path, importId.Value, ImportResultKind.Imported, recordCount, stopwatch, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Cancelled while processing {FileName} at stage {Stage}", fileName, stage);
            if (importId is { } id)
            {
                await TryMarkFailedAsync(id, $"Cancelled during {stage}.").ConfigureAwait(false);
            }

            throw;
        }
        catch (Exception ex)
        {
            return await FailAsync(fileName, importId, recordCount, stopwatch, stage, ex.Message, ex, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>The same file content already has a tracking record that is not Failed.</summary>
    private async Task<ImportOutcome> HandleExistingImportAsync(string path, ImportRecord existing, Stopwatch stopwatch, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(path);
        if (existing.Status == ImportStatus.Processing)
        {
            logger.LogWarning("Skipping {FileName}: the same content is being imported as {ImportId} (started {StartedAtUtc:u}). Left in place",
                fileName, existing.ImportId, existing.StartedAtUtc);
            return new ImportOutcome(fileName, ImportResultKind.InProgressElsewhere, existing.ImportId, 0, stopwatch.Elapsed);
        }

        // Imported or ArchivePending: the data is already in the database. Never load it again; just archive the file.
        logger.LogWarning("{FileName} was already imported as {ImportId} (status {Status}); skipping the import and archiving the file",
            fileName, existing.ImportId, existing.Status);
        return await ArchiveAsync(path, existing.ImportId, ImportResultKind.AlreadyImported, 0, stopwatch, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Moves an imported file to the archive. A failure here does not undo the import: the record becomes ArchivePending.</summary>
    private async Task<ImportOutcome> ArchiveAsync(string path, Guid importId, ImportResultKind successKind, int recordCount, Stopwatch stopwatch, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(path);
        string archivedPath;
        try
        {
            archivedPath = await retryPolicy.ExecuteAsync("archive file",
                _ => Task.FromResult(archiver.MoveToArchive(path)), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            stopwatch.Stop();
            logger.LogError(ex,
                "Import {ImportId} of {FileName} is committed but the file could not be archived. Status set to {Status}; the next run retries the move without re-importing",
                importId, fileName, ImportStatus.ArchivePending);

            try
            {
                await retryPolicy.ExecuteAsync("mark archive pending",
                    ct => repository.MarkArchivePendingAsync(importId, $"Archive failed: {ex.Message}", ct), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception markEx) when (markEx is not OperationCanceledException)
            {
                // The record stays Imported, which the next run treats the same way (archive only, no re-import).
                logger.LogError(markEx, "Could not set import {ImportId} to {Status}", importId, ImportStatus.ArchivePending);
            }

            await SendAlertAsync(new ImportAlert(fileName, importId, "Archive",
                $"The data was imported, but the file could not be moved to the archive folder: {ex.Message}. " +
                "It will not be imported again; the next run retries the move.", timeProvider.GetLocalNow()), cancellationToken).ConfigureAwait(false);

            LogOutcome(fileName, importId, recordCount, stopwatch, ImportStatus.ArchivePending);
            return new ImportOutcome(fileName, ImportResultKind.ImportedArchivePending, importId, recordCount, stopwatch.Elapsed, ex.Message);
        }

        try
        {
            await retryPolicy.ExecuteAsync("mark archived",
                ct => repository.MarkArchivedAsync(importId, archivedPath, ct), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The file is archived and the data imported; only the bookkeeping is missing.
            logger.LogWarning(ex, "File {FileName} was archived to {ArchivePath} but import {ImportId} could not be updated", fileName, archivedPath, importId);
        }

        stopwatch.Stop();
        logger.LogInformation("Archived {FileName} to {ArchivePath}", fileName, archivedPath);
        LogOutcome(fileName, importId, recordCount, stopwatch, successKind == ImportResultKind.Imported ? ImportStatus.Imported : "AlreadyImported");
        return new ImportOutcome(fileName, successKind, importId, recordCount, stopwatch.Elapsed);
    }

    private async Task<ImportOutcome> FailAsync(string fileName, Guid? importId, int recordCount, Stopwatch stopwatch,
        string stage, string error, Exception? exception, CancellationToken cancellationToken)
    {
        stopwatch.Stop();
        logger.LogError(exception, "{Stage} failed for {FileName} (ImportId {ImportId}); the file was left in place. Error: {Error}",
            stage, fileName, importId, error);

        if (importId is { } id)
        {
            await TryMarkFailedAsync(id, $"{stage}: {error}").ConfigureAwait(false);
        }

        await SendAlertAsync(new ImportAlert(fileName, importId, stage, error, timeProvider.GetLocalNow()), cancellationToken).ConfigureAwait(false);
        LogOutcome(fileName, importId, recordCount, stopwatch, ImportStatus.Failed);
        return new ImportOutcome(fileName, ImportResultKind.Failed, importId, recordCount, stopwatch.Elapsed, error);
    }

    private async Task TryMarkFailedAsync(Guid importId, string error)
    {
        try
        {
            // Not cancellable: the record should not be left as Processing when the run is stopped.
            await retryPolicy.ExecuteAsync("mark failed",
                ct => repository.MarkFailedAsync(importId, error, ct), CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not set import {ImportId} to {Status}. It will be retried after the processing timeout", importId, ImportStatus.Failed);
        }
    }

    /// <summary>Sends an alert; a broken mail server must never stop the import.</summary>
    private async Task SendAlertAsync(ImportAlert alert, CancellationToken cancellationToken)
    {
        try
        {
            await notifier.SendFailureAlertAsync(alert, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogError(ex, "Could not send the failure alert for {FileName}", alert.FileName);
        }
    }

    private void LogOutcome(string fileName, Guid? importId, int recordCount, Stopwatch stopwatch, string status) =>
        logger.LogInformation("Outcome {FileName}: {Status}, {RecordCount} record(s), ImportId {ImportId}, {ElapsedMs} ms",
            fileName, status, recordCount, importId, stopwatch.ElapsedMilliseconds);

    private static async Task<(string Hash, long Size)> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false);
        return (Convert.ToHexString(hash), stream.Length);
    }

    private static string Summarize(IReadOnlyList<string> errors)
    {
        var shown = errors.Take(MaxErrorsInSummary).ToList();
        var more = errors.Count - shown.Count;
        return string.Join(Environment.NewLine, shown) + (more > 0 ? $"{Environment.NewLine}... and {more} more." : string.Empty);
    }
}
