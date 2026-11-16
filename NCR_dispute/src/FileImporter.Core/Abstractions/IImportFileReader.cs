using FileImporter.Core.Models;

namespace FileImporter.Core.Abstractions;

/// <summary>Reads a source file into rows and checks its structure. Add another implementation for other file formats.</summary>
public interface IImportFileReader
{
    /// <summary>
    /// Reads the file. Structure and field problems are returned in <see cref="ImportFile.Errors"/>;
    /// exceptions are only thrown for I/O errors.
    /// </summary>
    Task<ImportFile> ReadAsync(string path, CancellationToken cancellationToken);
}
