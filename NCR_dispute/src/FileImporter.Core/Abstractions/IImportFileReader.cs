using FileImporter.Core.Models;

namespace FileImporter.Core.Abstractions;

/// <summary>Reads a source file into rows and checks its structure. Add another implementation for other file formats.</summary>
public interface IImportFileReader
{
    /// <summary>
    /// Parses the file content (already read from <paramref name="path"/>, which is used for naming only).
    /// Structure, encoding and field problems are returned in <see cref="ImportFile.Errors"/>, not thrown.
    /// </summary>
    ImportFile Read(string path, byte[] content, CancellationToken cancellationToken);
}
