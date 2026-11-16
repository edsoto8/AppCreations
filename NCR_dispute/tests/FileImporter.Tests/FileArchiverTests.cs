using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Tests.TestSupport;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests;

public sealed class FileArchiverTests : IDisposable
{
    private readonly TempFolder _folder = new();
    private readonly FileArchiver _archiver = new(Options.Create(new ImportOptions { ArchiveFolderName = "Archive" }), TimeProvider.System);

    public void Dispose() => _folder.Dispose();

    [Fact]
    public void MoveToArchive_CreatesArchiveSubfolderAndMovesFile()
    {
        var path = _folder.Write("disputes.csv", "content");

        var archived = _archiver.MoveToArchive(path);

        Assert.Equal(Path.Combine(_folder.ArchivePath, "disputes.csv"), archived);
        Assert.False(File.Exists(path));
        Assert.Equal("content", File.ReadAllText(archived));
    }

    [Fact]
    public void MoveToArchive_NameAlreadyArchived_KeepsBothFiles()
    {
        var first = _archiver.MoveToArchive(_folder.Write("disputes.csv", "first"));
        var second = _archiver.MoveToArchive(_folder.Write("disputes.csv", "second"));

        Assert.NotEqual(first, second);
        Assert.Equal("first", File.ReadAllText(first));
        Assert.Equal("second", File.ReadAllText(second));
        Assert.StartsWith("disputes_", Path.GetFileName(second));
        Assert.EndsWith(".csv", second);
    }

    [Fact]
    public void MoveToArchive_ArchiveFolderBlocked_ThrowsAndLeavesFile()
    {
        var path = _folder.Write("disputes.csv", "content");
        File.WriteAllText(_folder.ArchivePath, "a file where the folder should be");

        Assert.ThrowsAny<IOException>(() => _archiver.MoveToArchive(path));
        Assert.True(File.Exists(path));
    }
}
