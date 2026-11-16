using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Core.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests.TestSupport;

/// <summary>A FileImportService over a temp folder with the real CSV reader and archiver and fake database/e-mail.</summary>
public sealed class ImporterHarness : IDisposable
{
    public ImporterHarness(Action<ImportOptions>? configure = null, IImportRepository? repository = null)
    {
        Options = SampleData.Options(Folder.Path);
        configure?.Invoke(Options);
        var importOptions = Microsoft.Extensions.Options.Options.Create(Options);
        Archiver = new ControllableArchiver(new FileArchiver(importOptions, TimeProvider.System));
        RepositoryUnderTest = repository ?? Repository;
        Retry = new RetryPolicy(Microsoft.Extensions.Options.Options.Create(new RetryOptions { MaxAttempts = 3, InitialDelaySeconds = 0 }),
            TimeProvider.System, NullLogger<RetryPolicy>.Instance);

        Service = new FileImportService(
            new CsvFileReader(importOptions),
            RepositoryUnderTest,
            Archiver,
            Notifier,
            Retry,
            importOptions,
            TimeProvider.System,
            NullLogger<FileImportService>.Instance);
    }

    public TempFolder Folder { get; } = new();

    public ImportOptions Options { get; }

    public FakeImportRepository Repository { get; } = new();

    public IImportRepository RepositoryUnderTest { get; }

    public RecordingNotifier Notifier { get; } = new();

    public ControllableArchiver Archiver { get; }

    public RetryPolicy Retry { get; }

    public FileImportService Service { get; }

    public void Dispose() => Folder.Dispose();
}
