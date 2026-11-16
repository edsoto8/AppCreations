using FileImporter.Core.Models;
using FileImporter.Tests.TestSupport;

namespace FileImporter.Tests;

public sealed class FileImportServiceTests : IDisposable
{
    private readonly ImporterHarness _h = new();

    public void Dispose() => _h.Dispose();

    private CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Run_ValidFile_ImportsValidatesAndArchives()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv(rows: 5));

        var summary = await _h.Service.RunAsync(Ct);

        var outcome = Assert.Single(summary.Outcomes);
        Assert.Equal(ImportResultKind.Imported, outcome.Kind);
        Assert.Equal(5, outcome.RecordCount);
        Assert.True(summary.Succeeded);
        Assert.Equal(5, _h.Repository.LoadedRecords["disputes.csv"]);
        Assert.Equal(ImportStatus.Imported, _h.Repository["disputes.csv"].Status);
        Assert.NotNull(_h.Repository["disputes.csv"].ArchivePath);
        Assert.False(_h.Folder.Exists("disputes.csv"));
        Assert.True(_h.Folder.IsArchived("disputes.csv"));
        Assert.Empty(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_NoFiles_SucceedsWithNothingToDo()
    {
        var summary = await _h.Service.RunAsync(Ct);

        Assert.Empty(summary.Outcomes);
        Assert.True(summary.Succeeded);
    }

    [Fact]
    public async Task Run_DatabaseValidationFails_MarksFailedAlertsAndLeavesFileInPlace()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Repository.Validate = _ => ValidationResult.Failure("Row 2: Amount must be greater than zero");

        var summary = await _h.Service.RunAsync(Ct);

        var outcome = Assert.Single(summary.Outcomes);
        Assert.Equal(ImportResultKind.Failed, outcome.Kind);
        Assert.False(summary.Succeeded);
        var row = _h.Repository["disputes.csv"];
        Assert.Equal(ImportStatus.Failed, row.Status);
        Assert.Contains("Amount must be greater than zero", row.Error);
        Assert.False(_h.Repository.LoadedRecords.ContainsKey("disputes.csv"));

        Assert.True(_h.Folder.Exists("disputes.csv"));
        Assert.False(Directory.Exists(_h.Folder.ArchivePath));

        var alert = Assert.Single(_h.Notifier.Alerts);
        Assert.Equal("disputes.csv", alert.FileName);
        Assert.Equal(row.ImportId, alert.ImportId);
        Assert.Equal("Database validation", alert.Stage);
        Assert.Contains("Amount must be greater than zero", alert.ErrorSummary);
    }

    [Fact]
    public async Task Run_FileStructureInvalid_FailsBeforeLoadingAnything()
    {
        _h.Folder.Write("bad.csv", "DisputeId,AccountNumber\r\nD-1,ACCT-1\r\n");

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.Failed, Assert.Single(summary.Outcomes).Kind);
        Assert.Equal(0, _h.Repository.LoadAttempts);
        Assert.Equal(ImportStatus.Failed, _h.Repository["bad.csv"].Status);
        Assert.True(_h.Folder.Exists("bad.csv"));
        var alert = Assert.Single(_h.Notifier.Alerts);
        Assert.Equal("File validation", alert.Stage);
        Assert.Contains("missing required columns", alert.ErrorSummary);
        Assert.NotNull(alert.ImportId);
    }

    [Fact]
    public async Task Run_RequiredFieldMissing_FailsWithLineNumber()
    {
        _h.Folder.Write("bad.csv", SampleData.Header + "\r\nD-1,,2026-10-01,10.00,x\r\n");

        await _h.Service.RunAsync(Ct);

        var alert = Assert.Single(_h.Notifier.Alerts);
        Assert.Contains("Line 2, column 'AccountNumber': a value is required.", alert.ErrorSummary);
        Assert.True(_h.Folder.Exists("bad.csv"));
    }

    [Fact]
    public async Task Run_LoadThrowsNonTransientError_MarksFailedAndLeavesFile()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Repository.LoadFailures.Enqueue(new InvalidOperationException("Invalid column name 'Notes'."));

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.Failed, Assert.Single(summary.Outcomes).Kind);
        Assert.Equal(1, _h.Repository.LoadAttempts);
        Assert.Equal(ImportStatus.Failed, _h.Repository["disputes.csv"].Status);
        Assert.True(_h.Folder.Exists("disputes.csv"));
        var alert = Assert.Single(_h.Notifier.Alerts);
        Assert.Equal("Database import", alert.Stage);
        Assert.Contains("Invalid column name", alert.ErrorSummary);
    }

    [Fact]
    public async Task Run_TransientDatabaseError_IsRetriedAndImports()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Repository.LoadFailures.Enqueue(new TimeoutException("Execution timeout expired."));

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.Imported, Assert.Single(summary.Outcomes).Kind);
        Assert.Equal(2, _h.Repository.LoadAttempts);
        Assert.Equal(3, _h.Repository.LoadedRecords["disputes.csv"]);
        Assert.Empty(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_DuplicateOfImportedFile_IsNotImportedAgainButIsArchived()
    {
        _h.Folder.Write("first.csv", SampleData.ValidCsv());
        await _h.Service.RunAsync(Ct);

        // The same content arrives again, even under another name.
        _h.Folder.Write("first.csv", SampleData.ValidCsv());
        _h.Folder.Write("copy-of-first.csv", SampleData.ValidCsv());
        var summary = await _h.Service.RunAsync(Ct);

        Assert.All(summary.Outcomes, o => Assert.Equal(ImportResultKind.AlreadyImported, o.Kind));
        Assert.True(summary.Succeeded);
        Assert.Equal(1, _h.Repository.LoadAttempts);
        Assert.Single(_h.Repository.Rows);
        Assert.Equal(3, _h.Repository.LoadedRecords.Values.Sum());
        Assert.False(_h.Folder.Exists("first.csv"));
        Assert.False(_h.Folder.Exists("copy-of-first.csv"));
        Assert.Equal(3, Directory.GetFiles(_h.Folder.ArchivePath).Length); // original, renamed duplicate, copy
        Assert.Empty(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_SameContentBeingProcessedElsewhere_LeavesFileUntouched()
    {
        var path = _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path)));
        _h.Repository.Seed("disputes.csv", hash, ImportStatus.Processing);

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.InProgressElsewhere, Assert.Single(summary.Outcomes).Kind);
        Assert.True(summary.Succeeded);
        Assert.Equal(0, _h.Repository.LoadAttempts);
        Assert.True(_h.Folder.Exists("disputes.csv"));
        Assert.Empty(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_PreviouslyFailedFile_IsRetried()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Repository.Validate = _ => ValidationResult.Failure("Reference data missing");
        await _h.Service.RunAsync(Ct);

        _h.Repository.Validate = _ => ValidationResult.Success;
        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.Imported, Assert.Single(summary.Outcomes).Kind);
        Assert.Equal(2, _h.Repository.Rows.Count);
        Assert.Equal([ImportStatus.Failed, ImportStatus.Imported], _h.Repository.Rows.Select(r => r.Status));
        Assert.True(_h.Folder.IsArchived("disputes.csv"));
    }

    [Fact]
    public async Task Run_ArchiveFails_SetsArchivePendingAlertsAndKeepsImportedData()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Archiver.FailuresRemaining = int.MaxValue;

        var summary = await _h.Service.RunAsync(Ct);

        var outcome = Assert.Single(summary.Outcomes);
        Assert.Equal(ImportResultKind.ImportedArchivePending, outcome.Kind);
        Assert.False(summary.Succeeded);
        Assert.Equal(1, _h.Archiver.Calls); // access denied is not transient, so not retried
        var row = _h.Repository["disputes.csv"];
        Assert.Equal(ImportStatus.ArchivePending, row.Status);
        Assert.Equal(3, _h.Repository.LoadedRecords["disputes.csv"]); // the import itself stands
        Assert.True(_h.Folder.Exists("disputes.csv"));

        var alert = Assert.Single(_h.Notifier.Alerts);
        Assert.Equal("Archive", alert.Stage);
        Assert.Equal(row.ImportId, alert.ImportId);
        Assert.Contains("will not be imported again", alert.ErrorSummary);
    }

    [Fact]
    public async Task Run_AfterArchiveFailure_NextRunArchivesWithoutReimporting()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Archiver.FailuresRemaining = int.MaxValue;
        await _h.Service.RunAsync(Ct);

        _h.Archiver.FailuresRemaining = 0;
        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.AlreadyImported, Assert.Single(summary.Outcomes).Kind);
        Assert.Equal(1, _h.Repository.LoadAttempts);
        Assert.Equal(3, _h.Repository.LoadedRecords["disputes.csv"]);
        var row = Assert.Single(_h.Repository.Rows);
        Assert.Equal(ImportStatus.Imported, row.Status);
        Assert.NotNull(row.ArchivePath);
        Assert.True(_h.Folder.IsArchived("disputes.csv"));
    }

    [Fact]
    public async Task Run_ArchiveFailsOnceWithFileLock_IsRetried()
    {
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Archiver.FailuresRemaining = 1;
        _h.Archiver.Failure = () => new IOException("The process cannot access the file because it is being used by another process.");

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(ImportResultKind.Imported, Assert.Single(summary.Outcomes).Kind);
        Assert.True(_h.Folder.IsArchived("disputes.csv"));
        Assert.Empty(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_OneBadFile_DoesNotStopTheOthers()
    {
        _h.Folder.Write("a.csv", SampleData.ValidCsv(idPrefix: "A"));
        _h.Folder.Write("b.csv", "not,a,valid,file\r\n1,2,3,4\r\n");
        _h.Folder.Write("c.csv", SampleData.ValidCsv(idPrefix: "C"));
        _h.Folder.Write("ignored.txt", "not matched by the pattern");

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal(["a.csv", "b.csv", "c.csv"], summary.Outcomes.Select(o => o.FileName));
        Assert.Equal([ImportResultKind.Imported, ImportResultKind.Failed, ImportResultKind.Imported], summary.Outcomes.Select(o => o.Kind));
        Assert.Equal(1, summary.FailureCount);
        Assert.True(_h.Folder.IsArchived("a.csv"));
        Assert.True(_h.Folder.Exists("b.csv"));
        Assert.True(_h.Folder.IsArchived("c.csv"));
        Assert.True(_h.Folder.Exists("ignored.txt"));
        Assert.Single(_h.Notifier.Alerts);
    }

    [Fact]
    public async Task Run_AlertCannotBeSent_ImportRunStillCompletes()
    {
        _h.Folder.Write("bad.csv", "x\r\n1\r\n");
        _h.Folder.Write("good.csv", SampleData.ValidCsv());
        _h.Notifier.ThrowOnSend = new IOException("SMTP server unreachable");

        var summary = await _h.Service.RunAsync(Ct);

        Assert.Equal([ImportResultKind.Failed, ImportResultKind.Imported], summary.Outcomes.Select(o => o.Kind));
    }

    [Fact]
    public async Task Run_FileChangedVeryRecently_IsSkippedUntilNextRun()
    {
        using var h = new ImporterHarness(o => o.MinFileAgeSeconds = 3600);
        h.Folder.Write("still-copying.csv", SampleData.ValidCsv());

        var summary = await h.Service.RunAsync(Ct);

        Assert.Empty(summary.Outcomes);
        Assert.True(h.Folder.Exists("still-copying.csv"));
    }

    [Fact]
    public async Task Run_SourceDirectoryMissing_AlertsAndThrows()
    {
        using var h = new ImporterHarness(o => o.SourceDirectory = Path.Combine(Path.GetTempPath(), "does-not-exist-" + Guid.NewGuid()));

        await Assert.ThrowsAsync<DirectoryNotFoundException>(() => h.Service.RunAsync(Ct));

        var alert = Assert.Single(h.Notifier.Alerts);
        Assert.Null(alert.ImportId);
    }

    [Fact]
    public async Task Run_StartImportFailsWithDatabaseDown_FailsWithoutImportId()
    {
        var repository = new ThrowingBeginRepository();
        using var h = new ImporterHarness(repository: repository);
        h.Folder.Write("disputes.csv", SampleData.ValidCsv());

        var summary = await h.Service.RunAsync(Ct);

        var outcome = Assert.Single(summary.Outcomes);
        Assert.Equal(ImportResultKind.Failed, outcome.Kind);
        Assert.Null(outcome.ImportId);
        var alert = Assert.Single(h.Notifier.Alerts);
        Assert.Equal("Starting import", alert.Stage);
        Assert.True(h.Folder.Exists("disputes.csv"));
    }

    [Fact]
    public async Task Run_Cancelled_MarksImportFailedAndStops()
    {
        using var cts = new CancellationTokenSource();
        _h.Folder.Write("disputes.csv", SampleData.ValidCsv());
        _h.Repository.Validate = _ =>
        {
            cts.Cancel();
            throw new OperationCanceledException(cts.Token);
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _h.Service.RunAsync(cts.Token));

        Assert.Equal(ImportStatus.Failed, _h.Repository["disputes.csv"].Status);
        Assert.True(_h.Folder.Exists("disputes.csv"));
    }

    private sealed class ThrowingBeginRepository : FakeRepositoryBase
    {
        public override Task<ImportClaim> BeginImportAsync(string fileName, string fileHash, long fileSizeBytes, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Cannot open database \"NcrDispute\" requested by the login.");
    }

    private abstract class FakeRepositoryBase : Core.Abstractions.IImportRepository
    {
        public abstract Task<ImportClaim> BeginImportAsync(string fileName, string fileHash, long fileSizeBytes, CancellationToken cancellationToken);

        public Task<ValidationResult> LoadAndValidateAsync(Guid importId, ImportFile file, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task MarkFailedAsync(Guid importId, string error, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task MarkArchivePendingAsync(Guid importId, string error, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task MarkArchivedAsync(Guid importId, string archivePath, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
