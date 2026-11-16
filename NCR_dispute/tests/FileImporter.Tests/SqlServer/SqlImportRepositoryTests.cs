using Dapper;
using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Core.Models;
using FileImporter.Core.Services;
using FileImporter.Tests.TestSupport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests.SqlServer;

/// <summary>Runs against a real SQL Server when FILEIMPORTER_TEST_SQL is set (see <see cref="SqlServerFixture"/>).</summary>
public sealed class SqlImportRepositoryTests(SqlServerFixture db) : IClassFixture<SqlServerFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private SqlImportRepository Repository => db.Repository();

    private void RequireSqlServer() =>
        Assert.SkipUnless(db.IsAvailable, $"Set {SqlServerFixture.EnvironmentVariable} to a SQL Server connection string to run this test.");

    private Task<ImportClaim> BeginAsync(string fileName, string hash, SqlImportRepository? repository = null) =>
        (repository ?? Repository).BeginImportAsync(Guid.NewGuid(), fileName, hash, 1, Ct);

    private static string NewHash() => Convert.ToHexString(Guid.NewGuid().ToByteArray()) + Convert.ToHexString(Guid.NewGuid().ToByteArray());

    private static ImportFile Sample(string fileName) =>
        CsvFileReader.Parse(fileName, File.ReadAllText(Path.Combine(RepoPaths.SamplesFolder, fileName)), NcrColumns.Options());

    private async Task<(string Status, int StagingRows, string? ArchivePath, string? Error)> StateAsync(Guid importId)
    {
        await using var connection = db.Connect();
        return await connection.QuerySingleAsync<(string, int, string?, string?)>("""
            SELECT f.Status, (SELECT COUNT(*) FROM dbo.NcrDisputeStaging s WHERE s.ImportId = f.ImportId), f.ArchivePath, f.ErrorMessage
            FROM dbo.FileImport f WHERE f.ImportId = @importId
            """, new { importId });
    }

    [Fact]
    public async Task BeginImport_NewContent_CreatesProcessingRecord()
    {
        RequireSqlServer();

        var claim = await BeginAsync("a.csv", NewHash());

        Assert.True(claim.IsNew);
        Assert.Equal(ImportStatus.Processing, claim.Record.Status);
        Assert.Equal("a.csv", claim.Record.FileName);
    }

    [Fact]
    public async Task BeginImport_SameContentAlreadyActive_ReturnsExistingRecord()
    {
        RequireSqlServer();
        var hash = NewHash();
        var first = await BeginAsync("a.csv", hash);

        var second = await BeginAsync("renamed.csv", hash);

        Assert.False(second.IsNew);
        Assert.Equal(first.Record.ImportId, second.Record.ImportId);
    }

    [Fact]
    public async Task BeginImport_RetriedWithSameId_RecognisesItsOwnClaim()
    {
        RequireSqlServer();
        var id = Guid.NewGuid();
        var hash = NewHash();
        await Repository.BeginImportAsync(id, "a.csv", hash, 1, Ct);

        var retried = await Repository.BeginImportAsync(id, "a.csv", hash, 1, Ct);

        Assert.True(retried.IsNew);
        Assert.Equal(id, retried.Record.ImportId);
    }

    [Fact]
    public async Task MarkFailed_CommittedImport_IsNotChanged()
    {
        RequireSqlServer();
        using var file = Sample("ncr_disputes_20261116.csv");
        var claim = await BeginAsync(file.FileName, NewHash());
        await Repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        await Repository.MarkFailedAsync(claim.Record.ImportId, "Cancelled during Archive.", Ct);

        Assert.Equal(ImportStatus.Imported, (await StateAsync(claim.Record.ImportId)).Status);
        await using var connection = db.Connect();
        await connection.ExecuteAsync("DELETE FROM dbo.NcrDisputeStaging WHERE ImportId = @id", new { id = claim.Record.ImportId });
    }

    [Fact]
    public async Task BeginImport_AfterFailure_AllowsRetry()
    {
        RequireSqlServer();
        var hash = NewHash();
        var first = await BeginAsync("a.csv", hash);
        await Repository.MarkFailedAsync(first.Record.ImportId, "boom", Ct);

        var retry = await BeginAsync("a.csv", hash);

        Assert.True(retry.IsNew);
        Assert.NotEqual(first.Record.ImportId, retry.Record.ImportId);
    }

    [Fact]
    public async Task BeginImport_AbandonedProcessingRecord_IsFailedAndReplaced()
    {
        RequireSqlServer();
        var hash = NewHash();
        var stale = await BeginAsync("a.csv", hash);
        await using (var connection = db.Connect())
        {
            await connection.ExecuteAsync("UPDATE dbo.FileImport SET StartedAtUtc = DATEADD(HOUR, -3, SYSUTCDATETIME()) WHERE ImportId = @id",
                new { id = stale.Record.ImportId });
        }

        var retry = await BeginAsync("a.csv", hash);

        Assert.True(retry.IsNew);
        var (status, _, _, error) = await StateAsync(stale.Record.ImportId);
        Assert.Equal(ImportStatus.Failed, status);
        Assert.StartsWith("Abandoned", error);
    }

    [Fact]
    public async Task BeginImport_ConcurrentClaimsForSameContent_OnlyOneWins()
    {
        RequireSqlServer();
        var hash = NewHash();

        var claims = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => BeginAsync("a.csv", hash)));

        Assert.Single(claims, c => c.IsNew);
        Assert.Single(claims.Select(c => c.Record.ImportId).Distinct());
    }

    [Fact]
    public async Task LoadAndValidate_ValidFile_LoadsRowsAndMarksImportedTogether()
    {
        RequireSqlServer();
        using var file = Sample("ncr_disputes_20261116.csv");
        var claim = await BeginAsync(file.FileName, NewHash());

        var result = await Repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        Assert.True(result.IsValid, result.Message);
        var (status, rows, _, _) = await StateAsync(claim.Record.ImportId);
        Assert.Equal(ImportStatus.Imported, status);
        Assert.Equal(8, rows);

        await using var connection = db.Connect();
        var third = await connection.QuerySingleAsync<(int, string, string)>(
            "SELECT SourceRowNumber, DisputeId, Description FROM dbo.NcrDisputeStaging WHERE ImportId = @id AND SourceRowNumber = 3",
            new { id = claim.Record.ImportId });
        Assert.Equal((3, "D-1000003", "Merchandise not received, customer contacted merchant"), third);

        // Clean up so the cross-file DisputeId rule does not affect other tests.
        await connection.ExecuteAsync("DELETE FROM dbo.NcrDisputeStaging WHERE ImportId = @id", new { id = claim.Record.ImportId });
    }

    [Fact]
    public async Task LoadAndValidate_ProcedureRejectsFile_RollsBackRows()
    {
        RequireSqlServer();
        using var file = Sample("ncr_disputes_rejected_by_database_example.csv");
        var claim = await BeginAsync(file.FileName, NewHash());

        var result = await Repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        Assert.False(result.IsValid);
        Assert.Contains("appears more than once", result.Message);
        Assert.Contains("must be greater than zero", result.Message);
        var (status, rows, _, _) = await StateAsync(claim.Record.ImportId);
        Assert.Equal(ImportStatus.Processing, status); // the service marks it Failed
        Assert.Equal(0, rows);
    }

    [Fact]
    public async Task LoadAndValidate_ProcedureThrows_IsAValidationFailure()
    {
        RequireSqlServer();
        await using (var connection = db.Connect())
        {
            await connection.ExecuteAsync("""
                CREATE OR ALTER PROCEDURE dbo.usp_TestThrows @ImportId UNIQUEIDENTIFIER AS
                BEGIN
                    THROW 50001, N'Control totals do not match the trailer record.', 1;
                END
                """);
        }

        using var file = Sample("ncr_disputes_20261116.csv");
        var repository = db.Repository("dbo.usp_TestThrows");
        var claim = await BeginAsync(file.FileName, NewHash(), repository);

        var result = await repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        Assert.False(result.IsValid);
        Assert.Equal("Control totals do not match the trailer record.", result.Message);
        Assert.Equal(0, (await StateAsync(claim.Record.ImportId)).StagingRows);
    }

    [Fact]
    public async Task LoadAndValidate_CalledAgainAfterCommit_DoesNotLoadRowsTwice()
    {
        RequireSqlServer();
        using var file = Sample("ncr_disputes_20261116.csv");
        var claim = await BeginAsync(file.FileName, NewHash());
        await Repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        var again = await Repository.LoadAndValidateAsync(claim.Record.ImportId, file, Ct);

        Assert.True(again.IsValid);
        Assert.Equal(8, (await StateAsync(claim.Record.ImportId)).StagingRows);
        await using var connection = db.Connect();
        await connection.ExecuteAsync("DELETE FROM dbo.NcrDisputeStaging WHERE ImportId = @id", new { id = claim.Record.ImportId });
    }

    [Fact]
    public async Task MarkArchivePendingThenArchived_EndsImportedWithFirstArchivePath()
    {
        RequireSqlServer();
        var claim = await BeginAsync("a.csv", NewHash());
        var id = claim.Record.ImportId;

        await Repository.MarkArchivePendingAsync(id, "Archive failed: access denied", Ct);
        Assert.Equal(ImportStatus.ArchivePending, (await StateAsync(id)).Status);

        await Repository.MarkArchivedAsync(id, "/in/Archive/a.csv", Ct);
        await Repository.MarkArchivedAsync(id, "/in/Archive/a_2.csv", Ct);
        var (status, _, archivePath, error) = await StateAsync(id);
        Assert.Equal(ImportStatus.Imported, status);
        Assert.Equal("/in/Archive/a.csv", archivePath);
        Assert.Null(error);
    }

    [Fact]
    public async Task EndToEnd_ImportThenSameFileAgain_LoadsOnceAndArchivesBoth()
    {
        RequireSqlServer();
        using var folder = new TempFolder();
        var options = Options.Create(NcrColumns.Options(folder.Path));
        var notifier = new RecordingNotifier();
        var retry = new RetryPolicy(Options.Create(new RetryOptions { InitialDelaySeconds = 0 }), TimeProvider.System, NullLogger<RetryPolicy>.Instance);
        var service = new FileImportService(new CsvFileReader(options), db.Repository(), new FileArchiver(options, TimeProvider.System),
            notifier, retry, options, TimeProvider.System, NullLogger<FileImportService>.Instance);
        // Distinct DisputeIds so other tests' rows do not trip the cross-file rule.
        var content = File.ReadAllText(Path.Combine(RepoPaths.SamplesFolder, "ncr_disputes_20261116.csv")).Replace("D-1", "E2E-1");

        folder.Write("disputes.csv", content);
        var first = await service.RunAsync(Ct);
        folder.Write("disputes.csv", content);
        var second = await service.RunAsync(Ct);

        var imported = Assert.Single(first.Outcomes);
        Assert.Equal(ImportResultKind.Imported, imported.Kind);
        Assert.Equal(ImportResultKind.AlreadyImported, Assert.Single(second.Outcomes).Kind);
        Assert.Equal(8, (await StateAsync(imported.ImportId!.Value)).StagingRows);
        Assert.Equal(2, Directory.GetFiles(folder.ArchivePath).Length);
        Assert.Empty(notifier.Alerts);
    }
}
