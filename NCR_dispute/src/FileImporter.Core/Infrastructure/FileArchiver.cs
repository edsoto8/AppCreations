using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using Microsoft.Extensions.Options;

namespace FileImporter.Core.Infrastructure;

/// <summary>
/// Moves a file into the archive subfolder next to it (e.g. C:\Imports\Archive). If a file with the same name is
/// already archived, a timestamp is added to the new name so nothing is overwritten.
/// </summary>
public sealed class FileArchiver(IOptions<ImportOptions> options, TimeProvider timeProvider) : IFileArchiver
{
    public string MoveToArchive(string filePath)
    {
        var sourceDirectory = Path.GetDirectoryName(Path.GetFullPath(filePath))
            ?? throw new InvalidOperationException($"Cannot determine the folder of '{filePath}'.");
        var archiveDirectory = Path.Combine(sourceDirectory, options.Value.ArchiveFolderName);
        Directory.CreateDirectory(archiveDirectory);

        var fileName = Path.GetFileName(filePath);
        var destination = Path.Combine(archiveDirectory, fileName);
        if (File.Exists(destination))
        {
            var stamp = timeProvider.GetLocalNow().ToString("yyyyMMdd_HHmmssfff");
            destination = Path.Combine(archiveDirectory,
                $"{Path.GetFileNameWithoutExtension(fileName)}_{stamp}{Path.GetExtension(fileName)}");
        }

        File.Move(filePath, destination, overwrite: false);
        return destination;
    }
}
